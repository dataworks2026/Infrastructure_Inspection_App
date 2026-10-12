"""Recommendations PDF for one inspection: the approved records, with the
pictures of the findings they cover, on the organization's letterhead.

Issued, not previewed (Rev B 8.3, N7 / MAT-9): every call archives the
file as issued, writes a snapshot row (record ids, pinned rule versions,
statuses at generation, sha256 of the file) and logs the issue in the
audit trail. Regeneration produces a new stamped document under a new id;
nothing is ever overwritten.

Letterhead comes from organizations.settings["letterhead"]:
  firm_name, address, phone, email, website, logo_path, client_name,
  prepared_by. Anything missing falls back to the organization name, the
  asset location and the inspector on the inspection.
"""
import hashlib
import os
from datetime import datetime, timezone
from io import BytesIO
from uuid import uuid4
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.asset import Asset
from app.models.detection import Detection
from app.models.image import Image
from app.models.inspection import Inspection
from app.models.organization import Organization
from app.models.recommendation import (
    RecommendationDetectionLink,
    RecommendationLibraryEntry,
    RecommendationRecord,
    RecommendationReportSnapshot,
    RecommendationRun,
)
from app.services.recommendations.audit import record_audit_event
from app.services.reports import pdf_report as base
from app.services.reports.damage_codes import CODE_LABELS

SEVERITY_LABEL = {1: "1 - Minor", 2: "2 - Moderate", 3: "3 - Advanced", 4: "4 - Severe"}
TIER_FALLBACK = {1: "Immediate action", 2: "Planned repair", 3: "Monitor and maintain"}

_TITLE = ParagraphStyle("rec_title", fontName="Helvetica-Bold", fontSize=20, textColor=base._TEAL, leading=26)
_RULE = ParagraphStyle("rec_rule", fontName="Helvetica-Bold", fontSize=11, textColor=base._NAVY, leading=15)
_META = ParagraphStyle("rec_meta", fontName="Helvetica", fontSize=8.5, textColor=base._GREY_TEXT, leading=12)
_TIER = ParagraphStyle("rec_tier", fontName="Helvetica-Bold", fontSize=13, textColor=base._NAVY, leading=17, spaceBefore=10, spaceAfter=6)
_CELL = ParagraphStyle("rec_cell", fontName="Helvetica", fontSize=8.5, leading=11)
_CELL_SMALL = ParagraphStyle("rec_cell_small", fontName="Helvetica", fontSize=7.5, leading=10, textColor=base._GREY_TEXT)


class NoApprovedRecommendations(LookupError):
    """The inspection has no Approved record, so there is nothing to issue."""


def _abs_storage(path: str) -> str:
    if not path or os.path.isabs(path):
        return path
    return os.path.join(settings.STORAGE_BASE_PATH, path)


def _letterhead(org: Organization | None, asset: Asset | None, inspection: Inspection) -> dict:
    lh = ((org.settings or {}) if org else {}).get("letterhead") or {}
    return {
        "firm_name": lh.get("firm_name") or (org.name if org else "") or "",
        "address": lh.get("address") or "",
        "phone": lh.get("phone") or "",
        "email": lh.get("email") or "",
        "website": lh.get("website") or "",
        "logo_path": _abs_storage(lh.get("logo_path") or ""),
        "client_name": lh.get("client_name") or (asset.location_name if asset and asset.location_name else "") or "",
        "prepared_by": lh.get("prepared_by") or inspection.inspector_name or "",
    }


def _tier_labels(db: Session) -> dict:
    from sqlalchemy import text
    labels = dict(TIER_FALLBACK)
    for r in db.execute(text("select * from recommendation_priority_tiers")):
        row = dict(r._mapping)
        label = next((v for k, v in row.items() if k != "tier" and isinstance(v, str)), None)
        if label:
            labels[int(row["tier"])] = label
    return labels


def _damage_code(detection_class: str) -> str:
    for code, label in CODE_LABELS.items():
        if str(label).lower() == (detection_class or "").lower():
            return code
    return (detection_class or "??")[:2].upper()


def _image_path(img: Image | None) -> str | None:
    if img is None or not img.stored_path:
        return None
    return os.path.join(settings.STORAGE_BASE_PATH, img.stored_path)


def _collect(db: Session, organization_id: str, inspection_id: str) -> dict:
    run_ids = [
        r.id for r in db.query(RecommendationRun)
        .filter(RecommendationRun.organization_id == organization_id, RecommendationRun.inspection_id == inspection_id)
        .all()
    ]
    records = (
        db.query(RecommendationRecord)
        .filter(RecommendationRecord.organization_id == organization_id, RecommendationRecord.run_id.in_(run_ids))
        .all() if run_ids else []
    )
    links_by_record: dict[str, list[RecommendationDetectionLink]] = {}
    for link in db.query(RecommendationDetectionLink).filter(
        RecommendationDetectionLink.record_id.in_([r.id for r in records]) if records else False
    ).all():
        links_by_record.setdefault(link.record_id, []).append(link)
    detection_ids = {link.detection_id for links in links_by_record.values() for link in links}
    detections = {
        d.id: d for d in db.query(Detection).filter(Detection.id.in_(detection_ids)).all()
    } if detection_ids else {}
    image_ids = {d.image_id for d in detections.values() if d.image_id}
    images = {i.id: i for i in db.query(Image).filter(Image.id.in_(image_ids)).all()} if image_ids else {}
    entries = {}
    for rec in records:
        if rec.matched_entry_id:
            e = db.query(RecommendationLibraryEntry).filter(
                RecommendationLibraryEntry.entry_id == rec.matched_entry_id,
                RecommendationLibraryEntry.version == rec.matched_entry_version,
            ).first()
            if e:
                entries[rec.id] = e
    return {"records": records, "links": links_by_record, "detections": detections, "images": images, "entries": entries}


def _finding_rows(links, detections, images):
    rows = []
    for link in links:
        det = detections.get(link.detection_id)
        img = images.get(det.image_id) if det else None
        rows.append({
            "link": link,
            "detection": det,
            "image": img,
            "filename": (img.filename if img else "") or (link.detection_id[:8]),
            "severity_label": SEVERITY_LABEL.get(link.severity_at_generation, str(link.severity_at_generation)),
            "damage_code": _damage_code(link.detection_class),
        })
    return rows


def _finding_card(img, frs: list[dict]) -> Table:
    """One bordered card, the same layout as the inspection report: the picture
    on the left with only this recommendation's findings outlined, the findings
    table on the right. A single-row table never splits, so a card always moves
    to the next page whole."""
    w = base._content_width()
    pad = 0.09 * inch
    left_w = 3.05 * inch
    right_w = w - left_w

    dets = []
    for r in frs:
        d = r["detection"]
        bbox = None
        if d is not None and None not in (d.bbox_x1, d.bbox_y1, d.bbox_x2, d.bbox_y2):
            bbox = {"x1": d.bbox_x1, "y1": d.bbox_y1, "x2": d.bbox_x2, "y2": d.bbox_y2}
        dets.append({"bbox": bbox, "severity_label": r["severity_label"], "damage_code": r["damage_code"]})

    left: list = [Paragraph(escape(frs[0]["filename"]), base._H3), Spacer(1, 0.05 * inch)]
    flow = base._annotated_image_flowable(_image_path(img), dets, box_w=left_w - 2 * pad, box_h=3.1 * inch)
    left.append(flow if flow is not None else Paragraph("Picture not available", base._SMALL))

    right: list = [Paragraph("FINDINGS COVERED", base._BOLD), Spacer(1, 0.05 * inch)]
    det_rows: list = [["Type", "Severity", "Confidence"]]
    for r in frs:
        sev = Paragraph(r["severity_label"], ParagraphStyle(
            "sev_cell", fontName="Helvetica-Bold", fontSize=8,
            textColor=base._LABEL_COLOR.get(r["severity_label"], base._NAVY)))
        conf = f"{r['link'].confidence:.2f}" if r["link"].confidence is not None else ""
        det_rows.append([r["damage_code"], sev, conf])
    tw = right_w - 2 * pad
    dt = Table(det_rows, colWidths=[0.55 * inch, 1.15 * inch, tw - 1.7 * inch], repeatRows=1)
    dt.setStyle(TableStyle(base._standard_table_style()))
    dt.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    right.append(dt)
    right.append(Spacer(1, 0.05 * inch))
    n = len(frs)
    right.append(Paragraph(f"{n} finding{'s' if n != 1 else ''}", base._SMALL))

    card = Table([[left, right]], colWidths=[left_w, right_w])
    card.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.75, base._BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), pad),
        ("RIGHTPADDING", (0, 0), (-1, -1), pad),
        ("TOPPADDING", (0, 0), (-1, -1), pad),
        ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
    ]))
    return card


def _record_block(rec, entry, rows: list[dict], heading=None) -> list:
    text = escape(entry.recommendation_text if entry else "")
    n = len(rows)
    head: list = ([heading] if heading is not None else []) + [
        Paragraph(text, _RULE),
        Paragraph(
            f"{escape(entry.action_class if entry else '')} · {n} finding{'s' if n != 1 else ''} · "
            f"rule {escape(str(rec.matched_entry_id)[:8])} v{rec.matched_entry_version} · record {escape(rec.id[:8])}",
            _META,
        ),
        Spacer(1, 0.08 * inch),
    ]

    by_image: dict[str, list[dict]] = {}
    no_picture: list[dict] = []
    for r in rows:
        if r["image"] is None:
            no_picture.append(r)
        else:
            by_image.setdefault(r["image"].id, []).append(r)
    cards = [_finding_card(frs[0]["image"], frs) for frs in by_image.values()]

    block: list = []
    if cards:
        # the heading and rule text travel with the first card so they never end a page alone
        block.append(KeepTogether(head + [cards[0]]))
        for card in cards[1:]:
            block.append(Spacer(1, 0.18 * inch))
            block.append(card)
    else:
        block.append(KeepTogether(head))
    if no_picture:
        block.append(Spacer(1, 0.1 * inch))
        nrows = [["Finding", "Type", "Severity", "Confidence"]]
        for r in no_picture:
            nrows.append([
                Paragraph(escape(r["link"].detection_id[:8]), _CELL_SMALL), r["damage_code"],
                Paragraph(r["severity_label"], ParagraphStyle(
                    "sev", fontName="Helvetica-Bold", fontSize=9,
                    textColor=base._LABEL_COLOR.get(r["severity_label"], base._NAVY))),
                f"{r['link'].confidence:.2f}" if r["link"].confidence is not None else "",
            ])
        w = base._content_width()
        nt = Table(nrows, colWidths=[1.4 * inch, 0.8 * inch, 1.4 * inch, w - 3.6 * inch], repeatRows=1)
        nt.setStyle(TableStyle(base._standard_table_style()))
        block.append(Paragraph("Findings without a picture on file", base._SMALL))
        block.append(nt)
    block.append(Spacer(1, 0.22 * inch))
    return block


def _latest_run(db: Session, organization_id: str, inspection_id: str) -> RecommendationRun | None:
    return (
        db.query(RecommendationRun)
        .filter(RecommendationRun.organization_id == organization_id, RecommendationRun.inspection_id == inspection_id)
        .order_by(RecommendationRun.created_at.desc(), RecommendationRun.id.desc())
        .first()
    )


def build_recommendations_pdf(db: Session, organization_id: str, inspection_id: str, snapshot_id: str, issued_at: datetime) -> tuple[bytes, list[dict]]:
    """Render the document. Returns the PDF bytes and the record snapshot
    (every record of the inspection with its status and pinned rule version)."""
    inspection = db.query(Inspection).filter(Inspection.id == inspection_id, Inspection.organization_id == organization_id).first()
    if inspection is None:
        raise LookupError(f"Inspection {inspection_id!r} not found in this organization")
    asset = db.query(Asset).filter(Asset.id == inspection.asset_id).first()
    org = db.query(Organization).filter(Organization.organization_id == organization_id).first()
    lh = _letterhead(org, asset, inspection)
    tiers = _tier_labels(db)
    data = _collect(db, organization_id, inspection_id)
    run = _latest_run(db, organization_id, inspection_id)

    approved = [r for r in data["records"] if r.status == "Approved"]
    if not approved:
        raise NoApprovedRecommendations(f"No approved recommendations for inspection {inspection_id!r}")
    needs = [r for r in data["records"] if r.status == "Needs Recommendation"]
    superseded = [r for r in data["records"] if r.status == "Superseded"]

    by_tier: dict[int, list] = {}
    for rec in approved:
        entry = data["entries"].get(rec.id)
        tier = entry.tier_override if entry and entry.tier_override is not None else (entry.derived_tier if entry else 3)
        by_tier.setdefault(tier, []).append(rec)

    issued_str = issued_at.strftime("%d %b %Y, %H:%M UTC")
    footer_left = f"Issued {issued_str} · document {snapshot_id[:8]} · archived as issued"

    def _page(canvas, doc):
        canvas.saveState()
        W, H = letter
        top = H - 0.45 * inch
        x = 0.75 * inch
        x_text = x
        logo = lh["logo_path"]
        if logo and os.path.isfile(logo):
            try:
                canvas.drawImage(logo, x, top - 0.62 * inch, width=1.3 * inch, height=0.62 * inch,
                                 preserveAspectRatio=True, anchor="nw", mask="auto")
                x_text = x + 1.5 * inch
            except Exception:
                x_text = x
        canvas.setFillColor(base._NAVY)
        canvas.setFont("Helvetica-Bold", 12)
        canvas.drawString(x_text, top - 0.2 * inch, lh["firm_name"])
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(base._GREY_TEXT)
        line2 = " · ".join(v for v in (lh["address"], lh["phone"], lh["email"], lh["website"]) if v)
        canvas.drawString(x_text, top - 0.38 * inch, line2)
        canvas.setFont("Helvetica-Bold", 9)
        canvas.setFillColor(base._TEAL)
        canvas.drawRightString(W - 0.75 * inch, top - 0.2 * inch, "REPAIR RECOMMENDATIONS")
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(base._GREY_TEXT)
        if lh["client_name"]:
            canvas.drawRightString(W - 0.75 * inch, top - 0.38 * inch, f"Prepared for {lh['client_name']}")
        canvas.setStrokeColor(base._TEAL)
        canvas.setLineWidth(1.2)
        canvas.line(0.75 * inch, top - 0.72 * inch, W - 0.75 * inch, top - 0.72 * inch)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(base._GREY_TEXT)
        canvas.drawString(0.75 * inch, 0.45 * inch, footer_left)
        canvas.drawRightString(W - 0.75 * inch, 0.45 * inch, f"Page {doc.page}")
        canvas.restoreState()

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter, leftMargin=inch, rightMargin=inch, topMargin=1.5 * inch, bottomMargin=0.85 * inch,
        title=f"{(asset.name if asset else 'Inspection')} Repair Recommendations", author=lh["firm_name"],
    )
    w = base._content_width()
    story: list = []

    # Cover, the same shape as the inspection report cover
    story.append(Paragraph(escape((org.name if org else "") or lh["firm_name"]).upper(), base._ORG))
    story.append(Spacer(1, 0.15 * inch))
    story.append(Paragraph(escape(asset.name if asset else "Inspection"), base._H1))
    story.append(Spacer(1, 0.1 * inch))
    story.append(Paragraph("Repair Recommendations", base._H2))
    story.append(Spacer(1, 0.3 * inch))

    insp_date = inspection.inspection_date or inspection.inspected_at
    all_rows = [r for rec in approved for r in _finding_rows(data["links"].get(rec.id, []), data["detections"], data["images"])]
    total_findings = len(all_rows)
    meta_rows = [
        ("PREPARED FOR", lh["client_name"] or ""),
        ("PREPARED BY", " / ".join(v for v in (lh["firm_name"], lh["prepared_by"]) if v)),
        ("INSPECTION", inspection.name or inspection.id[:8]),
        ("INSPECTION DATE", insp_date.strftime("%B %d, %Y") if hasattr(insp_date, "strftime") else str(insp_date or "")),
        ("ISSUED", issued_str),
        ("RECOMMENDATIONS", f"{len(approved)} approved, covering {total_findings} finding{'s' if total_findings != 1 else ''}"),
        ("DOCUMENT", snapshot_id),
    ]
    label_w = 2.2 * inch
    mt = Table([[Paragraph(k, base._TEAL_LABEL), Paragraph(escape(v), base._BODY)] for k, v in meta_rows],
               colWidths=[label_w, w - label_w])
    mt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), base._TEAL),
        ("BACKGROUND", (1, 0), (1, -1), colors.white),
        ("TEXTCOLOR", (1, 0), (1, -1), base._NAVY),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, base._BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(mt)
    story.append(Spacer(1, 0.2 * inch))

    # Run reconciliation: every reviewed finding is accounted for in one of the four buckets
    if run is not None:
        story.append(Paragraph("RUN RECONCILIATION", base._SECTION_HEADING))
        rr = [
            ["Findings consumed", "Matched", "No rule yet", "Dismissed", "Skipped"],
            [str(run.total_detections), str(run.total_matched), str(run.total_unmatched),
             str(run.total_dismissed), str(run.total_skipped or 0)],
        ]
        rt = Table(rr, colWidths=[w / 5] * 5)
        rt.setStyle(TableStyle(base._standard_table_style()))
        story.append(rt)
        story.append(Spacer(1, 0.04 * inch))
        run_when = run.created_at.strftime("%d %b %Y, %H:%M UTC") if run.created_at else ""
        story.append(Paragraph(
            f"Matched {run.total_matched} + no rule yet {run.total_unmatched} + dismissed {run.total_dismissed} + "
            f"skipped {run.total_skipped or 0} = {run.total_detections} findings consumed by the run of {run_when}. "
            f"Approved recommendations in this document: {len(approved)}. "
            f"Findings still without a rule: {len(needs)}. Superseded records: {len(superseded)}.", base._SMALL))
        story.append(Spacer(1, 0.2 * inch))

    # Summary of what follows, in the shape of the defect summary table; the cards start right under it
    story.append(PageBreak())
    story.append(Paragraph("Recommendation Summary", base._H2))
    story.append(Spacer(1, 0.04 * inch))
    story.append(Paragraph(
        f"{len(approved)} approved recommendation{'s' if len(approved) != 1 else ''} covering {total_findings} "
        f"finding{'s' if total_findings != 1 else ''}.", base._SMALL))
    story.append(Spacer(1, 0.12 * inch))
    srows: list = [["Tier", "Finding type", "Recommendation", "Action", "Findings"]]
    for tier in sorted(by_tier):
        for rec in by_tier[tier]:
            entry = data["entries"].get(rec.id)
            cls = (entry.detection_class if entry else "") or ""
            srows.append([
                Paragraph(f"{tier} · {escape(tiers.get(tier, TIER_FALLBACK.get(tier, '')))}", _CELL),
                Paragraph(f"{escape(cls.title())} ({escape(_damage_code(cls))})", _CELL),
                Paragraph(escape(entry.recommendation_text if entry else ""), _CELL),
                Paragraph(escape(entry.action_class if entry else ""), _CELL),
                str(len(data["links"].get(rec.id, []))),
            ])
    srows.append(["TOTAL", "", "", "", str(total_findings)])
    st = Table(srows, colWidths=[1.45 * inch, 1.35 * inch, w - 4.9 * inch, 1.2 * inch, 0.9 * inch], repeatRows=1)
    st.setStyle(TableStyle(base._standard_table_style()))
    st.setStyle(TableStyle([
        ("BACKGROUND", (0, -1), (-1, -1), base._TOTAL_ROW),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(st)
    story.append(Spacer(1, 0.08 * inch))
    story.append(Paragraph(
        "Each recommendation that follows is the text of the library rule it was matched against, exactly as approved by "
        "the reviewing engineer. Each picture shows the findings that recommendation covers, outlined and coded with the "
        "finding type code above.", base._SMALL))
    story.append(Spacer(1, 0.25 * inch))

    for tier in sorted(by_tier):
        heading = Paragraph(f"Tier {tier} · {escape(tiers.get(tier, TIER_FALLBACK.get(tier, '')))}", _TIER)
        for i, rec in enumerate(by_tier[tier]):
            rows = _finding_rows(data["links"].get(rec.id, []), data["detections"], data["images"])
            story.extend(_record_block(rec, data["entries"].get(rec.id), rows, heading if i == 0 else None))

    if needs:
        story.append(Paragraph("Findings without a recommendation yet", _TIER))
        story.append(Paragraph(
            "These reviewed findings matched no rule in the library. They are listed so nothing is silently left out; "
            "a recommendation follows once a rule exists and an engineer approves it.", base._SMALL))
        story.append(Spacer(1, 0.08 * inch))
        nrows = [["Picture", "Type", "Severity"]]
        for rec in needs:
            for r in _finding_rows(data["links"].get(rec.id, []), data["detections"], data["images"]):
                nrows.append([Paragraph(escape(r["filename"]), _CELL_SMALL), r["damage_code"], Paragraph(r["severity_label"], _CELL)])
        nt = Table(nrows, colWidths=[3.2 * inch, 0.8 * inch, w - 4.0 * inch], repeatRows=1)
        nt.setStyle(TableStyle(base._standard_table_style()))
        story.append(nt)

    story.append(PageBreak())
    story.append(Paragraph("Issued record", _TIER))
    story.append(Paragraph(
        f"Document {snapshot_id}, issued {issued_str}. This file is archived as issued together with the list below. "
        "A later regeneration produces a new document with a new id; this one is never overwritten.", base._SMALL))
    story.append(Spacer(1, 0.1 * inch))
    irows = [["Record", "Status", "Rule", "Version", "Findings"]]
    snapshot = []
    for rec in sorted(data["records"], key=lambda r: (r.status, r.id)):
        n = len(data["links"].get(rec.id, []))
        irows.append([rec.id[:8], rec.status, (rec.matched_entry_id or "")[:8], str(rec.matched_entry_version or ""), str(n)])
        snapshot.append({
            "record_id": rec.id, "entry_id": rec.matched_entry_id, "entry_version": rec.matched_entry_version,
            "status": rec.status, "findings": n,
        })
    it = Table(irows, colWidths=[1.2 * inch, 1.9 * inch, 1.2 * inch, 0.9 * inch, w - 5.2 * inch], repeatRows=1)
    it.setStyle(TableStyle(base._standard_table_style()))
    story.append(it)

    doc.build(story, onFirstPage=_page, onLaterPages=_page)
    return buf.getvalue(), snapshot


def issue_recommendations_pdf(db: Session, organization_id: str, inspection_id: str, actor: str) -> tuple[bytes, RecommendationReportSnapshot]:
    """Build, archive, snapshot and audit. Caller commits."""
    snapshot_id = str(uuid4())
    issued_at = datetime.now(timezone.utc)
    pdf, record_snapshot = build_recommendations_pdf(db, organization_id, inspection_id, snapshot_id, issued_at)
    digest = hashlib.sha256(pdf).hexdigest()

    archive_dir = os.path.join(settings.STORAGE_BASE_PATH, "recommendation_reports", organization_id or "no-org", inspection_id)
    os.makedirs(archive_dir, exist_ok=True)
    archive_path = os.path.join(archive_dir, f"{snapshot_id}.pdf")
    if os.path.exists(archive_path):
        raise RuntimeError(f"archive collision for {archive_path}")
    with open(archive_path, "wb") as fh:
        fh.write(pdf)

    snap = RecommendationReportSnapshot(
        id=snapshot_id, organization_id=organization_id, inspection_id=inspection_id,
        generated_at=issued_at, generated_by=actor, issued_file_hash=digest, record_snapshot=record_snapshot,
    )
    db.add(snap)
    db.flush()
    record_audit_event(
        db, organization_id, actor, "recommendation_report_issued", "report_snapshot", snapshot_id,
        detail={
            "inspection_id": inspection_id, "issued_file_hash": digest, "records": len(record_snapshot),
            "approved": sum(1 for r in record_snapshot if r["status"] == "Approved"),
            "archived_path": os.path.relpath(archive_path, settings.STORAGE_BASE_PATH),
        },
    )
    return pdf, snap
