import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.core.config import settings
from app.database import engine, Base
from app.routers import auth, assets, inspections, images, analysis, dashboard, environmental, sensors
from app.routers import missions, telemetry, flight_logs, odm, thermal, predictive
import app.models  # noqa: ensure all models are registered

Base.metadata.create_all(bind=engine)
os.makedirs(settings.STORAGE_BASE_PATH, exist_ok=True)

app = FastAPI(title="Mira Intel API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/storage", StaticFiles(directory=settings.STORAGE_BASE_PATH), name="storage")

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(assets.router, prefix="/api/v1/assets", tags=["assets"])
app.include_router(inspections.router, prefix="/api/v1/inspections", tags=["inspections"])
app.include_router(images.router, prefix="/api/v1", tags=["images"])
app.include_router(analysis.router, prefix="/api/v1", tags=["analysis"])
app.include_router(dashboard.router, prefix="/api/v1/dashboard", tags=["dashboard"])
app.include_router(environmental.router, prefix="/api/v1/environmental", tags=["environmental"])
app.include_router(sensors.router, prefix="/api/v1/sensors", tags=["sensors"])
app.include_router(missions.router, prefix="/api/v1/missions", tags=["missions"])
app.include_router(telemetry.router, prefix="/api/v1/telemetry", tags=["telemetry"])
app.include_router(flight_logs.router, prefix="/api/v1/flight-logs", tags=["flight-logs"])
app.include_router(odm.router, prefix="/api/v1/odm", tags=["odm"])
app.include_router(thermal.router, prefix="/api/v1/thermal", tags=["thermal"])
app.include_router(predictive.router, prefix="/api/v1/predictive", tags=["predictive"])

@app.get("/health")
async def health():
    return {"status": "healthy"}
