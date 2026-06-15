"""ZIP of an inspection's FINAL annotated images for the Engineer Review Flow.

Served by GET /api/v1/inspections/{inspection_id}/annotated-images.zip.

This is the clean final deliverable: only engineer-VERIFIED detections are
burned in (accepted CV + engineer modified/added). No CV blue overlays, no
strikethroughs — unlike the per-detection review report (review_report.py),
which this module deliberately reuses the PIL helpers from.

The on-screen severity palette (frontend severityConfig) is used here, NOT the
annotation-app palette in review_report.py — engineers expect the burned-in
colours to match what they saw in the review UI.
"""
import math
import os
import zipfile
from io import BytesIO
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.asset import Asset
from app.models.detection import Detection
from app.models.detection_review import DetectionReview
from app.models.image import Image
from app.models.inspection import Inspection
from app.services.reports.review_report import (
    _PIL_AVAILABLE,
    _det_dict,
    _det_label_text,
    _draw_label,
    _load_font,
    _severity_num,
)

if _PIL_AVAILABLE:
    from PIL import Image as PILImage, ImageDraw

# Frontend on-screen severity palette (severityConfig) — must match the review
# UI, NOT the annotation-app palette used in review_report._SEV_RGB.
#   S1 green #4CAF50 · S2 amber #E6A817 · S3 orange #FF7043 · S4 red #B71C1C
_VIEW_SEV_RGB: dict[int, tuple[int, int, int]] = {
    1: (76, 175, 80),
    2: (230, 168, 23),
    3: (255, 112, 67),
    4: (183, 23, 29),
}


def render_annotated_jpeg(abs_path: str, verified: list[dict]) -> Optional[bytes]:
    """Burn the verified detections into the photo and return JPEG bytes.

    Returns None when PIL is unavailable or the file is missing/unreadable.
    Mirrors review_report._render_review_image's geometry (resize, stroke/font
    from the diagonal, alpha-composite the fills then draw labels on top) but
    paints ONLY the verified layer using the on-screen palette.
    """
    if not _PIL_AVAILABLE or not abs_path or not os.path.isfile(abs_path):
        return None
    try:
        im = PILImage.open(abs_path).convert("RGB")
    except Exception:
        return None

    scale = 1.0
    if im.width > 1400:
        scale = 1400 / im.width
        im = im.resize((1400, int(im.height * scale)), PILImage.LANCZOS)

    diag = math.hypot(im.width, im.height)
    stroke = max(2, int(diag / 500))
    font = _load_font(max(12, int(diag / 80)))

    def _sbox(det: dict) -> tuple[float, float, float, float]:
        x1, y1, x2, y2 = det["bbox"]
        x1, x2 = sorted((x1 * scale, x2 * scale))
        y1, y2 = sorted((y1 * scale, y2 * scale))
        return x1, y1, x2, y2

    # Translucent severity fills on an RGBA overlay, composited in one pass.
    overlay = PILImage.new("RGBA", im.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    for det in verified:
        sev = _severity_num(det.get("severity")) or 2
        r, g, b = _VIEW_SEV_RGB[sev]
        box = _sbox(det)
        if det.get("shape_type") == "ellipse":
            odraw.ellipse(box, fill=(r, g, b, 38), outline=(r, g, b, 204), width=stroke)
        else:
            odraw.rectangle(box, fill=(r, g, b, 38), outline=(r, g, b, 204), width=stroke)
    im = PILImage.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")

    # Solid label bars on top of the flattened image.
    draw = ImageDraw.Draw(im)
    for det in verified:
        sev = _severity_num(det.get("severity")) or 2
        _draw_label(draw, _sbox(det), _det_label_text(det), _VIEW_SEV_RGB[sev], font, im.size)

    buf = BytesIO()
    im.save(buf, format="JPEG", quality=85, optimize=True)
    return buf.getvalue()


def build_annotated_zip(db: Session, inspection_id: str) -> tuple[bytes, str]:
    """Build the ZIP of final annotated images. Returns (zip_bytes, name).

    Caller must org-scope the inspection FIRST (this queries by id only) and
    enforce status == review_completed.

    Every image present on disk is included so the ZIP is a complete final set:
      * image with >=1 verified detection → "{basename}_annotated.jpg" (burned in)
      * image with no verified detections → original file bytes, passthrough
        (lossless, original filename)
      * file missing on disk → skipped
    Returns empty bytes (b"") when NOTHING could be added (all files missing) so
    the endpoint can translate that to a 409.
    """
    inspection = db.query(Inspection).filter(Inspection.id == inspection_id).first()
    asset = (
        db.query(Asset).filter(Asset.id == inspection.asset_id).first()
        if inspection else None
    )
    name = (
        (inspection.name if inspection else None)
        or (asset.name if asset else None)
        or inspection_id
    )

    images = (
        db.query(Image)
        .filter(Image.inspection_id == inspection_id)
        .order_by(Image.filename, Image.id)
        .all()
    )

    # Build the verified detection set per image from the review rows.
    reviews = db.query(DetectionReview).filter(
        DetectionReview.inspection_id == inspection_id
    ).all()

    verified_det_ids: set[str] = set()
    # (image_id, detection_id) pairs we want, in case a detection's image_id
    # disagrees — we group by the review's image_id below.
    want: list[tuple[str, str]] = []
    for r in reviews:
        if r.action == "accepted" and r.cv_detection_id:
            verified_det_ids.add(r.cv_detection_id)
            want.append((r.image_id, r.cv_detection_id))
        elif r.action in ("modified", "added") and r.engineer_detection_id:
            verified_det_ids.add(r.engineer_detection_id)
            want.append((r.image_id, r.engineer_detection_id))
        # 'rejected' → excluded entirely

    dets_by_id: dict[str, dict] = {}
    if verified_det_ids:
        for d in db.query(Detection).filter(Detection.id.in_(verified_det_ids)).all():
            dets_by_id[d.id] = _det_dict(d)

    verified_by_image: dict[str, list[dict]] = {}
    for image_id, det_id in want:
        det = dets_by_id.get(det_id)
        if det is not None:
            verified_by_image.setdefault(image_id, []).append(det)

    base = settings.STORAGE_BASE_PATH
    buf = BytesIO()
    used_names: set[str] = set()
    added = 0

    def _unique(name_in: str) -> str:
        if name_in not in used_names:
            used_names.add(name_in)
            return name_in
        stem, ext = os.path.splitext(name_in)
        i = 2
        while f"{stem}_{i}{ext}" in used_names:
            i += 1
        out = f"{stem}_{i}{ext}"
        used_names.add(out)
        return out

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for img in images:
            abs_path = (
                os.path.join(base, img.stored_path) if img.stored_path else None
            )
            if not abs_path or not os.path.isfile(abs_path):
                continue  # file missing — skip

            filename = img.filename or img.original_filename or img.id
            verified = verified_by_image.get(img.id) or []

            if verified:
                jpeg = render_annotated_jpeg(abs_path, verified)
                if jpeg is not None:
                    basename = os.path.splitext(filename)[0]
                    zf.writestr(_unique(f"{basename}_annotated.jpg"), jpeg)
                    added += 1
                    continue
                # render failed (corrupt/unreadable) — fall through to passthrough

            # Clean image (or render failed): lossless passthrough of original.
            try:
                with open(abs_path, "rb") as fh:
                    raw = fh.read()
            except OSError:
                continue
            zf.writestr(_unique(filename), raw)
            added += 1

    if added == 0:
        return b"", name
    return buf.getvalue(), name
