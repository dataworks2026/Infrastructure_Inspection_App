import os, uuid, functools
from pathlib import Path
from typing import Optional
import numpy as np
from PIL import Image as PILImage
import torch

_original_torch_load = torch.load
@functools.wraps(_original_torch_load)
def _patched_torch_load(*args, **kwargs):
    kwargs['weights_only'] = False
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load

from ultralytics import YOLO
from app.core.config import settings

CLASS_NAMES_COASTAL = [
    'Biological Growth',
    'Coating Failure',
    'Corrosion',
    'Cracking',
    'Decay',
    'Loss',
    'Spalling',
]

SEVERITY_MAP = {
    'Biological Growth': 'S0',
    'Coating Failure':   'S1',
    'Corrosion':         'S2',
    'Cracking':          'S2',
    'Decay':             'S2',
    'Spalling':          'S2',
    'Loss':              'S3',
}

class CoastalService:
    def __init__(self, model_path: str):
        self.model_path = model_path
        self._model: Optional[YOLO] = None

    @property
    def model(self) -> YOLO:
        if self._model is None:
            if not os.path.exists(self.model_path):
                raise FileNotFoundError(
                    f"Coastal model not found at {self.model_path}. "
                    f"Copy coastal_damage_detector_cocobase.pt to ml_models/coastal/coastal_best.pt"
                )
            self._model = YOLO(self.model_path)
        return self._model

    def analyze(self, image_path: str) -> dict:
        if not os.path.exists(self.model_path):
            return {
                "detections": [],
                "annotated_image_path": None,
                "message": "Coastal model not found. Place coastal_best.pt in ml_models/coastal/."
            }

        results = self.model.predict(source=image_path, imgsz=640, conf=0.25, iou=0.45, verbose=False)
        res = results[0]

        annotated_bgr = res.plot()
        annotated_id = str(uuid.uuid4())
        rel_dir = os.path.dirname(image_path.replace(settings.STORAGE_BASE_PATH, "").lstrip("/\\"))
        annotated_rel = os.path.join(rel_dir, f"annotated_{annotated_id}.jpg").replace("\\", "/")
        annotated_abs = os.path.join(settings.STORAGE_BASE_PATH, annotated_rel)
        PILImage.fromarray(annotated_bgr[:, :, ::-1]).save(annotated_abs)

        detections = []
        if res.boxes and len(res.boxes) > 0:
            xyxy = res.boxes.xyxy.cpu().numpy()
            confs = res.boxes.conf.cpu().numpy()
            clss = res.boxes.cls.cpu().numpy().astype(int)
            names = self.model.names

            for i in range(len(clss)):
                damage_type = names.get(int(clss[i]), f"class_{clss[i]}")
                detections.append({
                    "damage_type": damage_type,
                    "confidence": float(confs[i]),
                    "severity": SEVERITY_MAP.get(damage_type, None),
                    "bbox": {
                        "x1": float(xyxy[i][0]), "y1": float(xyxy[i][1]),
                        "x2": float(xyxy[i][2]), "y2": float(xyxy[i][3])
                    }
                })

        return {"detections": detections, "annotated_image_path": annotated_rel}
