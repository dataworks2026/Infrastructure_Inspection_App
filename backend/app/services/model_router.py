from app.core.config import settings
from app.services.wind_turbine_service import WindTurbineService
from app.services.coastal_service import CoastalService

class ModelRouter:
    def __init__(self):
        self._wind_turbine = None
        self._coastal = None

    @property
    def wind_turbine(self):
        if self._wind_turbine is None:
            self._wind_turbine = WindTurbineService(settings.WIND_TURBINE_MODEL_PATH)
        return self._wind_turbine

    @property
    def coastal(self):
        if self._coastal is None:
            self._coastal = CoastalService(settings.COASTAL_MODEL_PATH)
        return self._coastal

    def analyze(self, infrastructure_type: str, image_path: str) -> dict:
        if infrastructure_type == "wind_turbine":
            return self.wind_turbine.analyze(image_path)
        elif infrastructure_type == "coastal":
            return self.coastal.analyze(image_path)
        else:
            return {"detections": [], "annotated_image_path": None,
                    "message": f"Model for {infrastructure_type} not yet available"}
