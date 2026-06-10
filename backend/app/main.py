import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from app.core.config import settings
from app.database import engine, Base
from app.routers import auth, assets, inspections, images, analysis, dashboard, environmental, sensors
from app.routers import missions, telemetry, flight_logs, odm, thermal, predictive, reports
from app.routers import drones, fleet, pilots, geofences, alerts, mission_records
from app.routers import comparison_pairs
import app.models  # noqa: F401

limiter = Limiter(key_func=get_remote_address)

# ── Sentry — init before app startup, skip if no DSN configured ──────
if settings.SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

    def _strip_pii(event: dict, hint: dict) -> dict:
        # Remove email and password fields from all request bodies
        request = event.get("request", {})
        data = request.get("data", {})
        if isinstance(data, dict):
            for key in ("email", "password", "token", "authorization"):
                data.pop(key, None)
        user = event.get("user", {})
        if isinstance(user, dict):
            user.pop("email", None)
            user.pop("ip_address", None)
        return event

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        traces_sample_rate=0.1,
        before_send=_strip_pii,
        send_default_pii=False,
    )

Base.metadata.create_all(bind=engine)
os.makedirs(settings.STORAGE_BASE_PATH, exist_ok=True)

app = FastAPI(title="Mira Intel API", version="1.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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
app.include_router(reports.router, prefix="/api/v1/reports", tags=["reports"])

# ── Phase D: GCS fleet, drone, pilot, geofence, alert, mission record ─────────
app.include_router(drones.router, prefix="/api/v1/drones", tags=["drones"])
app.include_router(fleet.router, prefix="/api/v1/fleet", tags=["fleet"])
app.include_router(pilots.router, prefix="/api/v1/pilots", tags=["pilots"])
app.include_router(geofences.router, prefix="/api/v1/geofences", tags=["geofences"])
app.include_router(alerts.router, prefix="/api/v1/alerts", tags=["alerts"])
app.include_router(mission_records.router, prefix="/api/v1/mission-records", tags=["mission-records"])
app.include_router(comparison_pairs.router, prefix="/api/v1", tags=["comparison-pairs"])

@app.get("/health")
async def health():
    return {"status": "healthy"}
