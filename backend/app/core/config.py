from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    SECRET_KEY: str = "change-me-in-production"
    DATABASE_URL: str = "sqlite:///./mira_intel.db"
    STORAGE_BASE_PATH: str = "./storage"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    WIND_TURBINE_MODEL_PATH: str = "./ml_models/wind_turbine/best.pt"
    COASTAL_MODEL_PATH: str = "./ml_models/coastal/coastal_best.pt"
    OPENAI_API_KEY: Optional[str] = None

    class Config:
        env_file = ".env"

settings = Settings()
