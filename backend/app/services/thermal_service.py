from __future__ import annotations
import os
import uuid
import numpy as np
from typing import Optional
from PIL import Image as PILImage

from sqlalchemy.orm import Session
from app.models.image import Image
from app.models.thermal_capture import ThermalCapture
from app.core.config import settings


def process_thermal_image(image_id: str, db: Session) -> ThermalCapture:
    """
    Process a thermal (R-JPEG) image from a DJI H20T or similar sensor.

    Extracts temperature data from the image, generates a heatmap overlay,
    and stores the results as a ThermalCapture record.
    """
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise ValueError(f"Image {image_id} not found")

    abs_path = os.path.join(settings.STORAGE_BASE_PATH, img.stored_path)
    if not os.path.exists(abs_path):
        raise FileNotFoundError(f"Image file not found: {abs_path}")

    # Open image and attempt to extract thermal data from EXIF
    pil_img = PILImage.open(abs_path)
    exif_data = pil_img.getexif() if hasattr(pil_img, "getexif") else {}

    # Convert image to grayscale numpy array as thermal proxy
    gray = np.array(pil_img.convert("L"), dtype=np.float32)

    # Map 0-255 grayscale to a plausible temperature range
    # Real R-JPEG would have embedded temperature data in EXIF
    # This is a simplified approach — in production, use exiftool for DJI R-JPEG
    temp_min_raw = float(exif_data.get(0x9211, 0))  # SubjectDistance as proxy
    if temp_min_raw == 0:
        # Default: map 0-255 to -10C to 60C range
        temp_array = (gray / 255.0) * 70.0 - 10.0
    else:
        temp_array = gray  # Use raw values if EXIF suggests calibrated data

    min_temp = float(np.min(temp_array))
    max_temp = float(np.max(temp_array))
    avg_temp = float(np.mean(temp_array))

    # Generate heatmap using matplotlib colormap
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.cm as cm

        # Normalize to 0-1 for colormap
        norm = (temp_array - min_temp) / (max_temp - min_temp + 1e-6)
        heatmap_rgba = cm.inferno(norm)
        heatmap_rgb = (heatmap_rgba[:, :, :3] * 255).astype(np.uint8)

        heatmap_img = PILImage.fromarray(heatmap_rgb)

        # Save heatmap alongside original
        heatmap_id = str(uuid.uuid4())
        heatmap_rel = f"inspections/{img.inspection_id}/{heatmap_id}_heatmap.png"
        heatmap_abs = os.path.join(settings.STORAGE_BASE_PATH, heatmap_rel)
        os.makedirs(os.path.dirname(heatmap_abs), exist_ok=True)
        heatmap_img.save(heatmap_abs)
        heatmap_path = heatmap_rel
    except ImportError:
        heatmap_path = None

    # Create ThermalCapture record
    capture = ThermalCapture(
        image_id=image_id,
        mission_id=img.mission_id,
        min_temp_c=round(min_temp, 2),
        max_temp_c=round(max_temp, 2),
        avg_temp_c=round(avg_temp, 2),
        raw_thermal_path=img.stored_path,
        heatmap_path=heatmap_path,
        palette="ironbow",
        radiometric_data={
            "source": "grayscale_proxy",
            "temp_range_c": [round(min_temp, 2), round(max_temp, 2)],
        },
    )
    db.add(capture)
    db.commit()
    db.refresh(capture)
    return capture
