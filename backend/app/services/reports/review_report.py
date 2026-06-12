"""Standalone Engineer Review Report PDF.

A per-detection CV-vs-Correction report (annotation-app style burned-in
images + comparison cards) served by
GET /api/v1/inspections/{inspection_id}/review-report.pdf.

Kept separate from pdf_report.py (the full inspection report) to keep both
modules manageable — shared style helpers are imported from pdf_report.
"""
import math
import os
from io import BytesIO
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image as RLImage,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

try:
    from PIL import Image as PILImage, ImageDraw, ImageFont
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.asset import Asset
from app.models.detection import Detection
from app.models.detection_review import DetectionReview
from app.models.image import Image
from app.models.inspection import Inspection
from app.models.organization import Organization
from app.services.reports.damage_codes import CODE_LABELS, map_damage_code
from app.services.reports.pdf_report import (
    _BODY,
    _BOLD,
    _BORDER,
    _GREY_TEXT,
    _H1,
    _H2,
    _NAVY,
    _SMALL,
    _TEAL,
    _TEAL_LABEL,
    _content_width,
    _review_conclusion,
    _standard_table_style,
)
from app.services.reports.review_diff import compute_review_diff

# ── Severity palette (annotation-app style, NOT the muted pdf_report one) ─────
_SEV_RGB: dict[int, tuple[int, int, int]] = {
    1: (34, 197, 94),    # green
    2: (234, 179, 8),    # yellow
    3: (249, 115, 22),   # orange
    4: (239, 68, 68),    # red
}
_SEV_HEX: dict[int, colors.HexColor] = {
    1: colors.HexColor("#22c55e"),
    2: colors.HexColor("#eab308"),
    3: colors.HexColor("#f97316"),
    4: colors.HexColor("#ef4444"),
}
_SEV_NAMES = {1: "Minor", 2: "Moderate", 3: "Advanced", 4: "Severe"}

_CV_BLUE_RGB = (59, 130, 246)
_STRIKE_RED_RGB = (239, 68, 68)

# Action badge colors
_ACTION_BADGE: dict[str, tuple[str, colors.HexColor]] = {
    "accepted": ("ACCEPTED", colors.HexColor("#22c55e")),
    "rejected": ("REJECTED", colors.HexColor("#ef4444")),
    "modified": ("MODIFIED", colors.HexColor("#f59e0b")),
    "added":    ("ENGINEER ADDED", colors.HexColor("#10b981")),
}
_CHANGED_BG = colors.HexColor("#fef3c7")   # amber-100 highlight for modified cells
_AMBER      = colors.HexColor("#f59e0b")
_GREEN      = colors.HexColor("#16a34a")
_RED        = colors.HexColor("#dc2626")

# Structural segment display labels (annotation-app vocabulary)
SEGMENT_LABELS: dict[str, str] = {
    "DT": "Deck - Topside",
    "DU": "Deck - Underside",
    "CP": "Pile Caps / Concrete Caps",
    "PT": "Timber Piles",
    "PS": "Steel Piles",
    "SZ": "Splash Zone",
    "FD": "Fender System",
    "BH": "Bulkhead / Seawall",
    "SS": "Steel Superstructure",
    "AR": "Anchors / Tie Rods",
    "AP": "Appurtenances",
    "BP": "Bearing Pads",
}

_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",   # linux servers
    "/Library/Fonts/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",       # macOS dev
    "/Library/Fonts/Arial Bold.ttf",
]


def _load_font(size: int):
    for path in _FONT_CANDIDATES:
        if os.path.isfile(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


# ── Detection → plain dict ────────────────────────────────────────────────────

def _severity_num(severity: Optional[str]) -> int:
    try:
        n = int(str(severity or "").lstrip("Ss") or 0)
    except ValueError:
        return 0
    return n if n in _SEV_NAMES else 0


def _severity_display(severity: Optional[str]) -> str:
    n = _severity_num(severity)
    return f"{n} - {_SEV_NAMES[n]}" if n else (severity or "—")


def _damage_code(det: dict) -> str:
    meta = det.get("domain_metadata") or {}
    code = meta.get("code")
    if code:
        return code
    code = map_damage_code(det.get("damage_type") or "")
    if code != "Unknown":
        return code
    dt = det.get("damage_type") or ""
    return dt[:2].upper() if dt else "??"


def _damage_display(det: dict) -> str:
    code = _damage_code(det)
    label = CODE_LABELS.get(code)
    if not label:
        label = (det.get("damage_type") or "Unknown").replace("_", " ").title()
    return f"{code} - {label}"


def _segments_display(det: dict) -> str:
    segs = (det.get("domain_metadata") or {}).get("segments") or []
    if not segs:
        return "—"
    return ", ".join(f"{s} - {SEGMENT_LABELS.get(s, s)}" for s in segs)


def _det_dict(d: Detection) -> dict:
    return {
        "id": d.id,
        "bbox": (
            float(d.bbox_x1 or 0), float(d.bbox_y1 or 0),
            float(d.bbox_x2 or 0), float(d.bbox_y2 or 0),
        ),
        "shape_type": d.shape_type or "rect",
        "damage_type": d.damage_type,
        "severity": d.severity,
        "confidence": float(d.confidence_score if d.confidence_score is not None
                            else (d.confidence or 0.0)),
        "domain_metadata": d.domain_metadata or {},
        "notes": d.inspector_notes,
    }


# ── Data assembly ──────────────────────────────────────────────────────────────

def build_review_report_data(db: Session, inspection_id: str) -> dict:
    """Gather everything the PDF needs. Caller must org-scope the inspection
    first (this queries by inspection_id only) and ensure review rows exist."""
    inspection = db.query(Inspection).filter(Inspection.id == inspection_id).first()
    asset = db.query(Asset).filter(Asset.id == inspection.asset_id).first() if inspection else None
    org_name = ""
    if asset and asset.organization_id:
        org = db.query(Organization).filter(
            Organization.organization_id == asset.organization_id
        ).first()
        org_name = org.name if org else ""

    diff = compute_review_diff(db, inspection_id)

    images = db.query(Image).filter(Image.inspection_id == inspection_id).all()
    images_by_id = {i.id: i for i in images}

    reviews = db.query(DetectionReview).filter(
        DetectionReview.inspection_id == inspection_id
    ).order_by(DetectionReview.created_at).all()

    det_ids = {r.cv_detection_id for r in reviews if r.cv_detection_id}
    det_ids |= {r.engineer_detection_id for r in reviews if r.engineer_detection_id}
    dets_by_id: dict[str, dict] = {}
    if det_ids:
        for d in db.query(Detection).filter(Detection.id.in_(det_ids)).all():
            dets_by_id[d.id] = _det_dict(d)

    per_image_stats = {p["image_id"]: p for p in diff["per_image"]}

    base = settings.STORAGE_BASE_PATH
    image_sections: list[dict] = []
    seen: set[str] = set()
    for r in reviews:                       # preserve review order
        if r.image_id in seen:
            continue
        seen.add(r.image_id)
        img = images_by_id.get(r.image_id)
        stats = per_image_stats.get(r.image_id, {})
        img_reviews = [rv for rv in reviews if rv.image_id == r.image_id]
        image_sections.append({
            "image_id": r.image_id,
            "filename": (img.filename or img.original_filename) if img else r.image_id,
            "abs_path": (os.path.join(base, img.stored_path)
                         if img and img.stored_path else None),
            "cv_count": stats.get("cv_count", 0),
            "final_count": stats.get("final_count", 0),
            "accuracy_pct": stats.get("accuracy_pct", 0.0),
            "reviews": [{
                "action": rv.action,
                "notes": rv.notes,
                "delta": rv.delta_json or {},
                "cv": dets_by_id.get(rv.cv_detection_id) if rv.cv_detection_id else None,
                "engineer": dets_by_id.get(rv.engineer_detection_id) if rv.engineer_detection_id else None,
            } for rv in img_reviews],
        })

    return {
        "inspection_id": inspection_id,
        "inspection_name": (inspection.name if inspection else None) or
                           (asset.name if asset else None) or inspection_id,
        "asset_name": asset.name if asset else "",
        "organization_name": org_name,
        "status": inspection.status if inspection else "",
        "partial": (inspection.status if inspection else "") == "pending_review",
        "diff": diff,
        "image_sections": image_sections,
    }


# ── PIL rendering (annotation-app style burn-in) ──────────────────────────────

def _dashed_line(draw, p1, p2, color, width, dash=12, gap=7):
    x1, y1 = p1
    x2, y2 = p2
    length = math.hypot(x2 - x1, y2 - y1)
    if length == 0:
        return
    ux, uy = (x2 - x1) / length, (y2 - y1) / length
    pos = 0.0
    while pos < length:
        end = min(pos + dash, length)
        draw.line(
            [(x1 + ux * pos, y1 + uy * pos), (x1 + ux * end, y1 + uy * end)],
            fill=color, width=width,
        )
        pos = end + gap


def _dashed_rect(draw, box, color, width):
    x1, y1, x2, y2 = box
    _dashed_line(draw, (x1, y1), (x2, y1), color, width)
    _dashed_line(draw, (x2, y1), (x2, y2), color, width)
    _dashed_line(draw, (x2, y2), (x1, y2), color, width)
    _dashed_line(draw, (x1, y2), (x1, y1), color, width)


def _dashed_ellipse(draw, box, color, width, step=14, arc=8):
    for a in range(0, 360, step):
        draw.arc(box, start=a, end=a + arc, fill=color, width=width)


def _text_size(draw, text, font) -> tuple[float, float]:
    try:
        l, t, r, b = draw.textbbox((0, 0), text, font=font)
        return r - l, b - t
    except Exception:
        return 7 * len(text), 14


def _draw_label(draw, box, text, rgb, font, img_size):
    """Solid-color label bar above the box (flipped below when clipping top)."""
    x1, y1, x2, y2 = box
    tw, th = _text_size(draw, text, font)
    pad = 4
    bar_h = th + 2 * pad
    ty = y1 - bar_h - 2
    if ty < 0:                       # clipping the top — flip below the box
        ty = min(y2 + 2, img_size[1] - bar_h)
    tx = max(0, min(x1, img_size[0] - (tw + 2 * pad)))
    draw.rectangle([tx, ty, tx + tw + 2 * pad, ty + bar_h], fill=rgb)
    draw.text((tx + pad, ty + pad - 1), text, font=font, fill=(255, 255, 255))


def _det_label_text(det: dict) -> str:
    sev = _severity_num(det.get("severity"))
    parts = [_damage_code(det)]
    if sev:
        parts.append(f"Sev {sev} ({_SEV_NAMES[sev]})")
    segs = (det.get("domain_metadata") or {}).get("segments") or []
    if segs:
        parts.append(", ".join(segs))
    return " | ".join(parts)


def _render_review_image(
    abs_path: str,
    verified: list[dict],
    cv_overlays: list[tuple[dict, str]],
    max_width_px: int = 1400,
) -> Optional[RLImage]:
    """Composite both layers onto the photo and return a reportlab flowable.

    verified    — final detections (accepted CV + engineer modified/added),
                  severity-colored fill at ~15% alpha, outline ~80% alpha.
    cv_overlays — (cv_detection, action) for rejected/modified CV originals,
                  dashed blue outline; rejected additionally struck through.
    Returns None when the file is missing/unreadable.
    """
    if not _PIL_AVAILABLE or not abs_path or not os.path.isfile(abs_path):
        return None
    try:
        im = PILImage.open(abs_path).convert("RGB")
    except Exception:
        return None

    scale = 1.0
    if im.width > max_width_px:
        scale = max_width_px / im.width
        im = im.resize((max_width_px, int(im.height * scale)), PILImage.LANCZOS)

    diag = math.hypot(im.width, im.height)
    stroke = max(2, int(diag / 500))
    font = _load_font(max(12, int(diag / 80)))

    def _sbox(det: dict) -> tuple[float, float, float, float]:
        x1, y1, x2, y2 = det["bbox"]
        x1, x2 = sorted((x1 * scale, x2 * scale))
        y1, y2 = sorted((y1 * scale, y2 * scale))
        return x1, y1, x2, y2

    # Layer 1 — verified detections on an RGBA overlay (translucent fills)
    overlay = PILImage.new("RGBA", im.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    for det in verified:
        sev = _severity_num(det.get("severity")) or 2
        r, g, b = _SEV_RGB[sev]
        box = _sbox(det)
        if det.get("shape_type") == "ellipse":
            odraw.ellipse(box, fill=(r, g, b, 38), outline=(r, g, b, 204), width=stroke)
        else:
            odraw.rectangle(box, fill=(r, g, b, 38), outline=(r, g, b, 204), width=stroke)
    im = PILImage.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")

    draw = ImageDraw.Draw(im)
    for det in verified:
        sev = _severity_num(det.get("severity")) or 2
        _draw_label(draw, _sbox(det), _det_label_text(det), _SEV_RGB[sev], font, im.size)

    # Layer 2 — CV originals that were rejected or modified (dashed blue)
    for det, action in cv_overlays:
        box = _sbox(det)
        if det.get("shape_type") == "ellipse":
            _dashed_ellipse(draw, box, _CV_BLUE_RGB, stroke)
        else:
            _dashed_rect(draw, box, _CV_BLUE_RGB, stroke)
        if action == "rejected":
            x1, y1, x2, y2 = box
            draw.line([(x1, y1), (x2, y2)], fill=_STRIKE_RED_RGB, width=stroke)
        _draw_label(draw, box, f"CV: {_det_label_text(det)}", _CV_BLUE_RGB, font, im.size)

    buf = BytesIO()
    im.save(buf, format="JPEG", quality=80, optimize=True)
    buf.seek(0)
    cw = _content_width()
    return RLImage(buf, width=cw, height=cw * (im.height / im.width))


# ── Comparison cards ──────────────────────────────────────────────────────────

_CELL = ParagraphStyle("rr_cell", fontName="Helvetica", fontSize=8.5, leading=12)
_CELL_BOLD = ParagraphStyle("rr_cell_b", fontName="Helvetica-Bold", fontSize=8.5, leading=12)
_CELL_MUTED = ParagraphStyle(
    "rr_cell_m", fontName="Helvetica-Oblique", fontSize=8.5, leading=12, textColor=_GREY_TEXT,
)
_BADGE = ParagraphStyle(
    "rr_badge", fontName="Helvetica-Bold", fontSize=9, textColor=colors.white,
)


def _sev_para(det: Optional[dict], bold: bool = False) -> Paragraph:
    if not det:
        return Paragraph("—", _CELL)
    n = _severity_num(det.get("severity"))
    color = _SEV_HEX.get(n, _NAVY)
    return Paragraph(
        _severity_display(det.get("severity")),
        ParagraphStyle(
            "rr_sev", fontName="Helvetica-Bold", fontSize=8.5, leading=12, textColor=color,
        ),
    )


def _bbox_display(det: Optional[dict]) -> str:
    if not det:
        return "—"
    x1, y1, x2, y2 = det["bbox"]
    text = f"{round(x1)},{round(y1)} → {round(x2)},{round(y2)}"
    if det.get("shape_type") == "ellipse":
        text += " (ellipse)"
    return text


def _conf_display(det: Optional[dict]) -> str:
    if not det:
        return "—"
    conf = det.get("confidence") or 0.0
    if conf > 1.0:       # tolerate 0–100 stored values
        conf /= 100.0
    return f"{round(conf * 100)}%"


def _review_card(review: dict, width: float) -> KeepTogether:
    action = review["action"]
    cv = review.get("cv")
    eng = review.get("engineer")
    delta = review.get("delta") or {}
    badge_text, badge_color = _ACTION_BADGE.get(action, (action.upper(), _NAVY))

    label_w = 1.35 * inch
    col_w = (width - label_w) / 2

    def _p(text: object, style=_CELL) -> Paragraph:
        return Paragraph(str(text) if text not in (None, "") else "—", style)

    # field rows: (label, cv cell, eng cell, changed?)
    rows: list[tuple[str, object, object, bool]] = [
        ("Damage Type", _p(_damage_display(cv)) if cv else None,
         _p(_damage_display(eng)) if eng else None, bool(delta.get("damage_type_changed"))),
        ("Severity", _sev_para(cv) if cv else None,
         _sev_para(eng) if eng else None, bool(delta.get("severity_changed"))),
        ("Confidence", _p(_conf_display(cv)) if cv else None,
         _p("Engineer verified") if eng else None, False),
        ("Bounding Box", _p(_bbox_display(cv)) if cv else None,
         _p(_bbox_display(eng)) if eng else None,
         bool(delta.get("bbox_changed") or delta.get("shape_changed"))),
        ("Structural Segments", _p(_segments_display(cv)) if cv else None,
         _p(_segments_display(eng)) if eng else None, bool(delta.get("segments_changed"))),
        ("Defect ID", _p((cv.get("domain_metadata") or {}).get("defect_id")) if cv else None,
         _p((eng.get("domain_metadata") or {}).get("defect_id")) if eng else None, False),
    ]

    data: list[list] = [[
        Paragraph(badge_text, _BADGE),
        Paragraph("CV Prediction", _TEAL_LABEL),
        Paragraph("Engineer Correction", _TEAL_LABEL),
    ]]
    style_cmds: list[tuple] = [
        ("BACKGROUND",    (0, 0), (0, 0),  badge_color),
        ("BACKGROUND",    (1, 0), (-1, 0), _NAVY),
        ("GRID",          (0, 0), (-1, -1), 0.5, _BORDER),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("FONTNAME",      (0, 1), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 1), (0, -1), 8),
        ("TEXTCOLOR",     (0, 1), (0, -1), _GREY_TEXT),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
    ]

    n_fields = len(rows)
    for i, (label, cv_cell, eng_cell, changed) in enumerate(rows, start=1):
        data.append([label, cv_cell or Paragraph("—", _CELL),
                     eng_cell or Paragraph("—", _CELL)])
        if action == "modified" and changed:
            style_cmds.append(("BACKGROUND", (2, i), (2, i), _CHANGED_BG))
            style_cmds.append(("BACKGROUND", (1, i), (1, i), _CHANGED_BG))

    # Spanned status cells for one-sided actions
    if action == "accepted":
        data[1][2] = Paragraph(
            "Accepted as-is ✓",
            ParagraphStyle("rr_acc", fontName="Helvetica-Bold", fontSize=9,
                           textColor=_GREEN, leading=12),
        )
        style_cmds.append(("SPAN", (2, 1), (2, n_fields)))
    elif action == "rejected":
        data[1][2] = Paragraph(
            "REJECTED — not a valid detection",
            ParagraphStyle("rr_rej", fontName="Helvetica-Bold", fontSize=9,
                           textColor=_RED, leading=12),
        )
        style_cmds.append(("SPAN", (2, 1), (2, n_fields)))
    elif action == "added":
        data[1][1] = Paragraph("— Missed by CV model —", _CELL_MUTED)
        style_cmds.append(("SPAN", (1, 1), (1, n_fields)))

    # Notes — full-width row (review notes win; fall back to engineer det notes)
    notes = review.get("notes") or (eng or {}).get("notes")
    if notes:
        data.append([
            "Notes",
            Paragraph(f"“{notes}”", _CELL_MUTED),
            "",
        ])
        style_cmds.append(("SPAN", (1, len(data) - 1), (2, len(data) - 1)))

    t = Table(data, colWidths=[label_w, col_w, col_w])
    t.setStyle(TableStyle(style_cmds))
    return KeepTogether([t, Spacer(1, 0.12 * inch)])


# ── Page assembly ─────────────────────────────────────────────────────────────

def _status_badge(partial: bool) -> Table:
    text = "REVIEW IN PROGRESS" if partial else "REVIEW COMPLETED"
    color = _AMBER if partial else _GREEN
    t = Table([[Paragraph(text, _BADGE)]], colWidths=[2.2 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), color),
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    t.hAlign = "LEFT"
    return t


def _cover_section(data: dict) -> list:
    w = _content_width()
    diff = data["diff"]
    totals = diff["totals"]
    elems: list = []

    if data.get("organization_name"):
        elems.append(Paragraph(data["organization_name"].upper(), _SMALL))
        elems.append(Spacer(1, 0.1 * inch))
    elems.append(Paragraph("Engineer Review Report", _H1))
    elems.append(Spacer(1, 0.06 * inch))
    elems.append(Paragraph(data["inspection_name"], _H2))
    if data.get("asset_name") and data["asset_name"] != data["inspection_name"]:
        elems.append(Paragraph(f"Asset: {data['asset_name']}", _BODY))
    elems.append(Spacer(1, 0.12 * inch))
    elems.append(_status_badge(data["partial"]))
    elems.append(Spacer(1, 0.12 * inch))

    reviewed_at = diff.get("reviewed_at")
    reviewed_at_str = (reviewed_at.strftime("%B %d, %Y %H:%M UTC")
                       if hasattr(reviewed_at, "strftime") else (str(reviewed_at) if reviewed_at else "—"))
    elems.append(Paragraph(
        f"Reviewed by <b>{diff.get('reviewed_by') or '—'}</b> — {reviewed_at_str}",
        _BODY,
    ))
    elems.append(Spacer(1, 0.25 * inch))

    # Summary stats row
    stats = [
        ("Total CV", totals["cv_detections"]),
        ("Accepted", totals["accepted"]),
        ("Rejected", totals["rejected"]),
        ("Modified", totals["modified"]),
        ("Added", totals["engineer_added"]),
        ("CV Accuracy", f"{totals['accuracy_pct']}%"),
    ]
    stat_table = Table(
        [[Paragraph(label, _TEAL_LABEL) for label, _ in stats],
         [Paragraph(f"<b>{value}</b>", _BODY) for _, value in stats]],
        colWidths=[w / 6] * 6,
    )
    stat_table.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), _TEAL),
        ("GRID",          (0, 0), (-1, -1), 0.5, _BORDER),
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    elems.append(stat_table)
    elems.append(Spacer(1, 0.25 * inch))

    # Damage-type accuracy
    dmg = diff.get("damage_type_accuracy") or {}
    if dmg:
        elems.append(Paragraph("ACCURACY BY DAMAGE TYPE", _BOLD))
        elems.append(Spacer(1, 0.06 * inch))
        rows = [["Damage Type", "CV", "Accepted", "Rejected", "Modified", "Accuracy"]]
        for key in sorted(dmg.keys()):
            c = dmg[key]
            rows.append([
                (key or "unknown").replace("_", " ").title(),
                str(c["cv"]), str(c["accepted"]), str(c["rejected"]),
                str(c["modified"]), f"{c['pct']}%",
            ])
        col_w = (w - 2.2 * inch) / 5
        dt = Table(rows, colWidths=[2.2 * inch] + [col_w] * 5)
        cmds = _standard_table_style()
        cmds.append(("ALIGN", (1, 0), (-1, -1), "CENTER"))
        dt.setStyle(TableStyle(cmds))
        elems.append(dt)
        elems.append(Spacer(1, 0.2 * inch))

    conclusion = _review_conclusion(totals, dmg)
    if conclusion:
        elems.append(Paragraph("<b>Conclusion</b>", _BOLD))
        elems.append(Spacer(1, 0.05 * inch))
        elems.append(Paragraph(conclusion, _BODY))

    elems.append(PageBreak())
    return elems


def _image_section(section: dict) -> list:
    w = _content_width()
    elems: list = []

    elems.append(Paragraph(section["filename"], _H2))
    elems.append(Paragraph(
        f"CV detections: {section['cv_count']} · "
        f"Final verified: {section['final_count']} · "
        f"Accuracy: {section['accuracy_pct']}%",
        _SMALL,
    ))
    elems.append(Spacer(1, 0.1 * inch))

    verified: list[dict] = []
    cv_overlays: list[tuple[dict, str]] = []
    for rv in section["reviews"]:
        if rv["action"] == "accepted" and rv["cv"]:
            verified.append(rv["cv"])
        elif rv["action"] in ("modified", "added") and rv["engineer"]:
            verified.append(rv["engineer"])
        if rv["action"] in ("rejected", "modified") and rv["cv"]:
            cv_overlays.append((rv["cv"], rv["action"]))

    flowable = _render_review_image(section.get("abs_path") or "", verified, cv_overlays)
    if flowable is not None:
        elems.append(flowable)
    else:
        elems.append(Paragraph(
            "<i>Source image unavailable on disk — annotated photo omitted.</i>",
            _SMALL,
        ))
    elems.append(Spacer(1, 0.15 * inch))

    elems.append(Paragraph("PER-DETECTION COMPARISON", _BOLD))
    elems.append(Spacer(1, 0.08 * inch))
    for rv in section["reviews"]:
        elems.append(_review_card(rv, w))

    elems.append(PageBreak())
    return elems


def _make_footer(partial: bool):
    def _footer(canvas, doc) -> None:
        canvas.saveState()
        w, h = letter
        if partial:
            # diagonal watermark on every page while the review is incomplete
            canvas.saveState()
            canvas.translate(w / 2, h / 2)
            canvas.rotate(38)
            canvas.setFont("Helvetica-Bold", 54)
            try:
                canvas.setFillColorRGB(0.62, 0.62, 0.62, alpha=0.10)
            except TypeError:
                canvas.setFillColorRGB(0.92, 0.92, 0.92)
            canvas.drawCentredString(0, 0, "REVIEW IN PROGRESS")
            canvas.restoreState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(_GREY_TEXT)
        canvas.drawString(inch * 0.75, 0.45 * inch,
                          "CONFIDENTIAL — NOT FOR DISTRIBUTION")
        canvas.drawRightString(w - inch * 0.75, 0.45 * inch, str(doc.page))
        canvas.restoreState()
    return _footer


def generate_review_report_pdf(db: Session, inspection_id: str) -> tuple[bytes, str]:
    """Build the review report. Returns (pdf_bytes, inspection_name).
    Caller must org-scope the inspection and verify review data exists."""
    data = build_review_report_data(db, inspection_id)

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=inch,
        rightMargin=inch,
        topMargin=inch,
        bottomMargin=0.8 * inch,
        title=f"{data['inspection_name']} — Engineer Review Report",
        author=data.get("organization_name") or "",
    )

    story: list = []
    story.extend(_cover_section(data))
    for section in data["image_sections"]:
        story.extend(_image_section(section))
    if isinstance(story[-1], PageBreak):
        story.pop()

    footer = _make_footer(data["partial"])
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue(), data["inspection_name"]
