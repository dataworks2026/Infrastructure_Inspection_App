import os
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image as RLImage,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

try:
    from PIL import Image as PILImage, ImageDraw
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False

_TEAL      = colors.HexColor("#2aa8a0")
_NAVY      = colors.HexColor("#1e2d4a")
_GREY_TEXT = colors.HexColor("#6b7280")
_ROW_ALT   = colors.HexColor("#f0f4f8")
_BORDER    = colors.HexColor("#d1d5db")
_TOTAL_ROW = colors.HexColor("#e5e7eb")

_SEV_MINOR    = colors.HexColor("#16a34a")
_SEV_MODERATE = colors.HexColor("#d97706")
_SEV_ADVANCED = colors.HexColor("#ea580c")
_SEV_SEVERE   = colors.HexColor("#dc2626")

_LABEL_COLOR: dict[str, object] = {
    "1 - Minor":    _SEV_MINOR,
    "2 - Moderate": _SEV_MODERATE,
    "3 - Advanced": _SEV_ADVANCED,
    "4 - Severe":   _SEV_SEVERE,
}

_BODY  = ParagraphStyle("body",  fontName="Helvetica",            fontSize=9,  leading=13)
_BOLD  = ParagraphStyle("bold",  fontName="Helvetica-Bold",       fontSize=9,  leading=13)
_H1    = ParagraphStyle("h1",    fontName="Helvetica-Bold",       fontSize=22, textColor=_TEAL,      leading=28)
_H2    = ParagraphStyle("h2",    fontName="Helvetica-Bold",       fontSize=14, textColor=_NAVY,      leading=18)
_H3    = ParagraphStyle("h3",    fontName="Helvetica-BoldOblique",fontSize=10, textColor=_TEAL,      leading=14)
_SMALL = ParagraphStyle("small", fontName="Helvetica",            fontSize=8,  textColor=_GREY_TEXT, leading=11)
_ORG   = ParagraphStyle(
    "org",
    fontName="Helvetica-Bold",
    fontSize=9,
    textColor=_GREY_TEXT,
    spaceAfter=4,
)
_TEAL_LABEL = ParagraphStyle(
    "teal_label",
    fontName="Helvetica-Bold",
    fontSize=9,
    textColor=colors.white,
)
_SECTION_HEADING = ParagraphStyle(
    "section_heading",
    fontName="Helvetica-Bold",
    fontSize=10,
    textColor=_TEAL,
    spaceBefore=6,
    spaceAfter=6,
)

def _content_width() -> float:
    return letter[0] - 2 * inch


def _standard_table_style() -> list[tuple]:
    return [
        ("BACKGROUND",    (0, 0), (-1, 0),  _TEAL),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  colors.white),
        ("FONTNAME",      (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0),  9),
        ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE",      (0, 1), (-1, -1), 9),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.white, _ROW_ALT]),
        ("GRID",          (0, 0), (-1, -1), 0.5, _BORDER),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
    ]

def _page_footer(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(_GREY_TEXT)
    w, _ = letter
    canvas.drawString(
        inch * 0.75, 0.45 * inch,
        "CONFIDENTIAL \u2014 NOT FOR DISTRIBUTION",
    )
    canvas.drawRightString(w - inch * 0.75, 0.45 * inch, str(doc.page))
    canvas.restoreState()

def _cover_page(meta: dict, total_annotations: int) -> list:
    w = _content_width()
    elems: list = []

    elems.append(Paragraph(meta.get("organization_name", "").upper(), _ORG))
    elems.append(Spacer(1, 0.15 * inch))
    elems.append(Paragraph(meta.get("asset_name", "Inspection Report"), _H1))
    elems.append(Spacer(1, 0.1 * inch))
    elems.append(Paragraph("Visual Damage Assessment Report", _H2))
    elems.append(Spacer(1, 0.3 * inch))

    def _fmt(value: object) -> str:
        return str(value) if value is not None else ""

    inspection_type   = meta.get("inspection_type", "").replace("-", " ").title()
    inspection_method = meta.get("inspection_method", "").replace("-", " ").title()
    status            = meta.get("status", "").upper()

    rows = [
        ("LOCATION",          _fmt(meta.get("location_name"))),
        ("INSPECTION DATE",   _fmt(meta.get("inspection_date"))),
        ("REPORT TYPE",       inspection_type),
        ("INSPECTION METHOD", inspection_method),
        ("TOTAL IMAGES",      _fmt(meta.get("total_images"))),
        ("TOTAL ANNOTATIONS", _fmt(total_annotations)),
        ("INSPECTOR",         _fmt(meta.get("inspector_name"))),
        ("REPORT STATUS",     status),
    ]

    label_w = 2.2 * inch
    value_w = w - label_w
    table_data = [
        [Paragraph(label, _TEAL_LABEL), Paragraph(value, _BODY)]
        for label, value in rows
    ]

    t = Table(table_data, colWidths=[label_w, value_w])
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (0, -1), _TEAL),
        ("BACKGROUND",    (1, 0), (1, -1), colors.white),
        ("TEXTCOLOR",     (1, 0), (1, -1), _NAVY),
        ("FONTNAME",      (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE",      (0, 0), (-1, -1), 9),
        ("GRID",          (0, 0), (-1, -1), 0.5, _BORDER),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
    ]))
    elems.append(t)
    elems.append(PageBreak())
    return elems


def _reference_guide_page() -> list:
    w = _content_width()
    elems: list = []

    elems.append(Paragraph("Damage & Segment Reference Guide", _H2))
    elems.append(Spacer(1, 0.15 * inch))

    elems.append(Paragraph("DAMAGE TYPES", _SECTION_HEADING))
    damage_data = [
        ["Code", "Type",               "Description"],
        ["CR",  "Cracking",            "Observable cracking in structural elements"],
        ["SP",  "Spalling",            "Observable spalling in structural elements"],
        ["CO",  "Corrosion",           "Observable corrosion in structural elements"],
        ["LO",  "Loss",                "Observable loss in structural elements"],
        ["DE",  "Decay",               "Observable decay in structural elements"],
        ["BG",  "Biological Growth",   "Observable biological growth in structural elements"],
        ["CF",  "Coating Failure",     "Observable coating failure in structural elements"],
        ["RS",  "Rust Staining",       "Observable rust staining in structural elements"],
    ]
    dt = Table(damage_data, colWidths=[0.6 * inch, 1.5 * inch, w - 2.1 * inch])
    dt.setStyle(TableStyle(_standard_table_style()))
    elems.append(dt)
    elems.append(Spacer(1, 0.25 * inch))

    elems.append(Paragraph("SEVERITY LEVELS", _SECTION_HEADING))
    sev_data = [
        ["Level", "Label",    "Description"],
        ["1",     "Minor",    "Surface-level, no structural concern"],
        ["2",     "Moderate", "Notable deterioration, monitor closely"],
        ["3",     "Advanced", "Significant deterioration, action recommended"],
        ["4",     "Severe",   "Critical deterioration, immediate action required"],
    ]
    sev_cmds = _standard_table_style()
    sev_cmds += [
        ("TEXTCOLOR", (1, 1), (1, 1), _SEV_MINOR),
        ("TEXTCOLOR", (1, 2), (1, 2), _SEV_MODERATE),
        ("TEXTCOLOR", (1, 3), (1, 3), _SEV_ADVANCED),
        ("TEXTCOLOR", (1, 4), (1, 4), _SEV_SEVERE),
        ("FONTNAME",  (1, 1), (1, 4), "Helvetica-Bold"),
    ]
    st = Table(sev_data, colWidths=[0.6 * inch, 1.0 * inch, w - 1.6 * inch])
    st.setStyle(TableStyle(sev_cmds))
    elems.append(st)
    elems.append(Spacer(1, 0.25 * inch))

    elems.append(Paragraph("STRUCTURAL SEGMENT CODES", _SECTION_HEADING))
    seg_data = [
        ["Code", "Segment",              "Description"],
        ["DT",  "Deck - Topside",        "Deck surface, slab, pavement, curbs"],
        ["DU",  "Deck - Underside",      "Underside of deck slabs, beams, soffits"],
        ["CP",  "Pile Caps",             "Concrete pile caps, headstocks, pedestals"],
        ["PT",  "Timber Piles",          "Vertical timber piles or columns"],
        ["PS",  "Steel Piles",           "Vertical steel piles or columns"],
        ["SZ",  "Splash Zone",           "Waterline transition zone"],
        ["FD",  "Fender System",         "Fender piles, wales, rub boards"],
        ["BH",  "Bulkhead / Seawall",    "Vertical seawall or bulkhead faces"],
        ["SS",  "Steel Superstructure",  "Cranes, gantries, steel frames"],
        ["AR",  "Anchors / Tie Rods",    "Tie rods, anchor rods, tension members"],
        ["AP",  "Appurtenances",         "Bolts, brackets, plates, ladders, railings"],
    ]
    sgt = Table(seg_data, colWidths=[0.6 * inch, 1.6 * inch, w - 2.2 * inch])
    sgt.setStyle(TableStyle(_standard_table_style()))
    elems.append(sgt)
    elems.append(PageBreak())
    return elems


def _defect_summary_page(summary: dict) -> list:
    w = _content_width()
    total      = summary["total_detections"]
    img_count  = summary["total_images"]
    elems: list = []

    elems.append(Paragraph("Defect Summary", _H2))
    elems.append(Spacer(1, 0.08 * inch))
    elems.append(Paragraph(
        f"Summary of all {total} annotations across {img_count} inspected images.",
        _BODY,
    ))
    elems.append(Spacer(1, 0.2 * inch))

    header = ["Damage Type", "1 \u2013 Minor", "2 \u2013 Moderate", "3 \u2013 Advanced", "4 \u2013 Severe", "Total"]
    rows   = [header]
    colored_cells: list[tuple] = []

    for i, row in enumerate(summary["matrix"], start=1):
        def _cell(v: int) -> str:
            return str(v) if v else "\u2014"

        rows.append([
            f"{row['label']}\n({row['code']})",
            _cell(row["minor"]),
            _cell(row["moderate"]),
            _cell(row["advanced"]),
            _cell(row["severe"]),
            str(row["total"]),
        ])
        for col_idx, key, color in [
            (1, "minor",    _SEV_MINOR),
            (2, "moderate", _SEV_MODERATE),
            (3, "advanced", _SEV_ADVANCED),
            (4, "severe",   _SEV_SEVERE),
        ]:
            if row[key]:
                colored_cells.append((col_idx, i, color))

    totals = summary["column_totals"]
    rows.append([
        Paragraph("<b>TOTAL</b>",             _BOLD),
        Paragraph(f"<b>{totals['minor']}</b>",    _BOLD),
        Paragraph(f"<b>{totals['moderate']}</b>", _BOLD),
        Paragraph(f"<b>{totals['advanced']}</b>", _BOLD),
        Paragraph(f"<b>{totals['severe']}</b>",   _BOLD),
        Paragraph(f"<b>{totals['total']}</b>",    _BOLD),
    ])

    col_w = w / 6
    t = Table(rows, colWidths=[col_w * 2] + [col_w] * 5)

    style_cmds = [
        ("BACKGROUND",     (0, 0), (-1, 0),  _NAVY),
        ("TEXTCOLOR",      (0, 0), (-1, 0),  colors.white),
        ("FONTNAME",       (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",       (0, 0), (-1, -1), 9),
        ("ALIGN",          (1, 0), (-1, -1), "CENTER"),
        ("ALIGN",          (0, 0), (0, -1),  "LEFT"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, _ROW_ALT]),
        ("BACKGROUND",     (0, -1), (-1, -1), _TOTAL_ROW),
        ("GRID",           (0, 0), (-1, -1), 0.5, _BORDER),
        ("VALIGN",         (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",     (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING",  (0, 0), (-1, -1), 6),
        ("LEFTPADDING",    (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",   (0, 0), (-1, -1), 8),
    ]
    for col_idx, row_idx, color in colored_cells:
        style_cmds.append(("TEXTCOLOR", (col_idx, row_idx), (col_idx, row_idx), color))
        style_cmds.append(("FONTNAME",  (col_idx, row_idx), (col_idx, row_idx), "Helvetica-Bold"))

    t.setStyle(TableStyle(style_cmds))
    elems.append(t)
    elems.append(PageBreak())
    return elems


_BBOX_COLOR_RGB = {
    "1 - Minor":    (22, 163, 74),
    "2 - Moderate": (217, 119, 6),
    "3 - Advanced": (234, 88, 12),
    "4 - Severe":   (220, 38, 38),
}

def _annotated_image_flowable(
    image_path: str,
    detections: list[dict],
    max_width_px: int = 1200,
) -> RLImage | None:
    """Open the image, draw a bbox + severity label per detection, return
    a reportlab Image flowable. Returns None if the file is missing or the
    image can't be decoded — caller falls back to the text-only block.
    """
    if not _PIL_AVAILABLE or not image_path or not os.path.isfile(image_path):
        return None
    try:
        im = PILImage.open(image_path).convert("RGB")
    except Exception:
        return None

    # Downscale before drawing — keeps PDF small while keeping bboxes readable.
    if im.width > max_width_px:
        scale = max_width_px / im.width
        new_size = (max_width_px, int(im.height * scale))
        im = im.resize(new_size, PILImage.LANCZOS)
    else:
        scale = 1.0

    draw = ImageDraw.Draw(im)
    stroke = max(2, int(im.width / 400))

    for d in detections:
        bbox = d.get("bbox")
        if not bbox:
            continue
        rgb = _BBOX_COLOR_RGB.get(d["severity_label"], (30, 45, 74))
        x1, y1 = bbox["x1"] * scale, bbox["y1"] * scale
        x2, y2 = bbox["x2"] * scale, bbox["y2"] * scale
        if x2 < x1: x1, x2 = x2, x1
        if y2 < y1: y1, y2 = y2, y1
        draw.rectangle([x1, y1, x2, y2], outline=rgb, width=stroke)

        label = f"{d['damage_code']} · {d['severity_label'].split(' - ')[0]}"
        tw = draw.textlength(label) if hasattr(draw, "textlength") else 6 * len(label)
        th = stroke * 6
        tx, ty = x1, max(0, y1 - th - 2)
        draw.rectangle([tx, ty, tx + tw + 8, ty + th], fill=rgb)
        draw.text((tx + 4, ty + 1), label, fill=(255, 255, 255))

    buf = BytesIO()
    im.save(buf, format="JPEG", quality=78, optimize=True)
    buf.seek(0)

    # Fit to content width while keeping aspect ratio
    cw = _content_width()
    aspect = im.height / im.width
    return RLImage(buf, width=cw, height=cw * aspect)


def _image_block(img: dict) -> list:
    w = _content_width()
    block: list = []

    block.append(Paragraph(img["image_filename"], _H3))
    block.append(Spacer(1, 0.05 * inch))

    flowable = _annotated_image_flowable(img.get("image_path"), img["detections"])
    if flowable is not None:
        block.append(flowable)
        block.append(Spacer(1, 0.08 * inch))

    block.append(Paragraph("DAMAGE FINDINGS", _BOLD))
    block.append(Spacer(1, 0.05 * inch))

    # Hide the Segment column entirely if every detection is UNK — avoids a
    # whole column of meaningless "UNK" cells when image.component_type
    # isn't populated in the upstream pipeline.
    show_segment = any(
        (d.get("segment") or "UNK") != "UNK" for d in img["detections"]
    )

    if show_segment:
        det_rows = [["Type", "Severity", "Segment(s)"]]
    else:
        det_rows = [["Type", "Severity"]]

    for d in img["detections"]:
        sev_color = _LABEL_COLOR.get(d["severity_label"], _NAVY)
        sev_para  = Paragraph(
            d["severity_label"],
            ParagraphStyle(
                "sev_cell",
                fontName="Helvetica-Bold",
                fontSize=9,
                textColor=sev_color,
            ),
        )
        row = [d["damage_code"], sev_para]
        if show_segment:
            row.append(d["segment"])
        det_rows.append(row)

    if show_segment:
        col_widths = [0.7 * inch, 1.6 * inch, w - 2.3 * inch]
    else:
        col_widths = [0.7 * inch, w - 0.7 * inch]
    dt = Table(det_rows, colWidths=col_widths)
    dt.setStyle(TableStyle(_standard_table_style()))
    block.append(dt)
    block.append(Spacer(1, 0.06 * inch))

    n = len(img["detections"])
    block.append(Paragraph(f"{n} annotation{'s' if n != 1 else ''}", _SMALL))
    block.append(Spacer(1, 0.25 * inch))
    return block


def _image_findings_pages(findings: list[dict]) -> list:
    # When the photo can be embedded, give each image its own page (the photo
    # alone fills most of the content area). When falling back to text-only
    # blocks (Andrew's original mode), pack two per page.
    elems: list = []
    i = 0
    while i < len(findings):
        img = findings[i]
        block = _image_block(img)
        has_photo = img.get("image_path") and os.path.isfile(img.get("image_path") or "")
        large = len(img["detections"]) > 6 or has_photo

        if large:
            elems.extend(block)
            elems.append(PageBreak())
            i += 1
        elif i + 1 < len(findings) and len(findings[i + 1]["detections"]) <= 6:
            elems.extend(block)
            elems.extend(_image_block(findings[i + 1]))
            elems.append(PageBreak())
            i += 2
        else:
            elems.extend(block)
            elems.append(PageBreak())
            i += 1

    return elems


def _narrative_page(narrative: dict) -> list:
    elems: list = []
    elems.append(Paragraph("Assessment Narrative", _H2))
    elems.append(Spacer(1, 0.2 * inch))

    summary_text = narrative.get("executive_summary", "")
    if summary_text:
        elems.append(Paragraph("<b>Executive Summary</b>", _BOLD))
        elems.append(Spacer(1, 0.08 * inch))
        elems.append(Paragraph(summary_text, _BODY))
        elems.append(Spacer(1, 0.2 * inch))

    technical = narrative.get("technical_findings", "")
    if technical:
        elems.append(Paragraph("<b>Technical Findings</b>", _BOLD))
        elems.append(Spacer(1, 0.08 * inch))
        elems.append(Paragraph(technical, _BODY))
        elems.append(Spacer(1, 0.2 * inch))

    recs = narrative.get("recommendations", [])
    if recs:
        elems.append(Paragraph("<b>Recommendations</b>", _BOLD))
        elems.append(Spacer(1, 0.08 * inch))
        for rec in recs:
            if isinstance(rec, str):
                text = rec
            elif isinstance(rec, dict) and "action" in rec:
                text = f"<b>{rec['action']}</b> {rec.get('rationale', '')}"
            else:
                text = rec.get("text", str(rec))
            elems.append(Paragraph(f"\u2022 {text}", _BODY))
            elems.append(Spacer(1, 0.06 * inch))

    return elems

def generate_pdf(report_data: dict) -> bytes:
    buf = BytesIO()
    meta    = report_data["metadata"]
    summary = report_data["summary"]

    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=inch,
        rightMargin=inch,
        topMargin=inch,
        bottomMargin=0.8 * inch,
        title=f"{meta.get('asset_name', 'Inspection')} Report",
        author=meta.get("organization_name", ""),
    )

    story: list = []
    story.extend(_cover_page(meta, summary["total_detections"]))
    story.extend(_reference_guide_page())
    story.extend(_defect_summary_page(summary))
    story.extend(_image_findings_pages(report_data["image_findings"]))
    story.extend(_narrative_page(report_data["narrative"]))

    doc.build(story, onFirstPage=_page_footer, onLaterPages=_page_footer)
    return buf.getvalue()
