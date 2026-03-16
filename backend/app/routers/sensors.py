"""Sensors API — live + historical NOAA data for asset locations."""

import asyncio
import time
import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.core.deps import get_db, get_current_user
from app.models.user import User
from app.models.asset import Asset
from app.services.noaa import (
    fetch_coops_latest,
    fetch_coops_range,
    fetch_ndbc_latest,
    DEFAULT_COOPS_STATION,
    DEFAULT_NDBC_STATION,
)

router = APIRouter()

# ── In-memory cache (5-min TTL) ─────────────────────────────
_cache: dict[str, dict] = {}
CACHE_TTL = 300

# Station mapping per asset (could later come from DB)
# For now all Governor's Island assets use the same nearby stations
ASSET_STATIONS = {
    "default": {
        "coops": DEFAULT_COOPS_STATION,  # The Battery, NY
        "ndbc": DEFAULT_NDBC_STATION,    # NY Harbor Entrance
    }
}


def _get_stations(asset_id: int) -> dict:
    return ASSET_STATIONS.get(str(asset_id), ASSET_STATIONS["default"])


def _ms_to_mph(ms: float | None) -> float | None:
    """Convert m/s to mph."""
    return round(ms * 2.23694, 1) if ms is not None else None


def _c_to_f(c: float | None) -> float | None:
    """Convert Celsius to Fahrenheit."""
    return round(c * 9 / 5 + 32, 1) if c is not None else None


@router.get("/live")
async def get_live_sensor_data(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Live NOAA readings for all org assets."""
    org_id = current_user.organization_id
    cached = _cache.get(f"live_{org_id}")
    if cached and (time.time() - cached["ts"]) < CACHE_TTL:
        return cached["data"]

    assets = (
        db.query(Asset.id, Asset.name, Asset.latitude, Asset.longitude, Asset.location_name)
        .filter(
            Asset.organization_id == org_id,
            Asset.latitude.isnot(None),
            Asset.longitude.isnot(None),
        )
        .all()
    )

    if not assets:
        result = {"assets": {}, "updated_at": time.time()}
        _cache[f"live_{org_id}"] = {"ts": time.time(), "data": result}
        return result

    asset_data = {}
    async with httpx.AsyncClient() as client:
        for a in assets:
            stations = _get_stations(a.id)

            # Fetch all NOAA data in parallel
            temp_res, wind_res, water_res, ndbc_res = await asyncio.gather(
                fetch_coops_latest(client, stations["coops"], "air_temperature"),
                fetch_coops_latest(client, stations["coops"], "wind"),
                fetch_coops_latest(client, stations["coops"], "water_level"),
                fetch_ndbc_latest(client, stations["ndbc"]),
            )

            # Parse CO-OPS responses
            temp_val = None
            if temp_res["value"]:
                try:
                    temp_val = float(temp_res["value"].get("v", 0))
                except (ValueError, TypeError, AttributeError):
                    pass

            wind_speed = None
            wind_dir = None
            wind_gust = None
            if wind_res["value"]:
                try:
                    wind_speed = float(wind_res["value"].get("s", 0))
                    wind_dir = wind_res["value"].get("d", "")
                    wind_gust = float(wind_res["value"].get("g", 0))
                except (ValueError, TypeError, AttributeError):
                    pass

            water_level = None
            if water_res["value"]:
                try:
                    water_level = float(water_res["value"].get("v", 0))
                except (ValueError, TypeError, AttributeError):
                    pass

            asset_data[a.id] = {
                "asset_name": a.name,
                "location_name": a.location_name,
                "latitude": a.latitude,
                "longitude": a.longitude,
                "temperature_f": temp_val,
                "wind_speed_kn": wind_speed,
                "wind_direction": wind_dir,
                "wind_gust_kn": wind_gust,
                "water_level_ft": water_level,
                "wave_height_m": ndbc_res.get("wave_height"),
                "wave_period_s": ndbc_res.get("wave_period"),
                "ndbc_wind_speed_mph": _ms_to_mph(ndbc_res.get("wind_speed")),
                "ndbc_wind_gust_mph": _ms_to_mph(ndbc_res.get("wind_gust")),
                "water_temp_f": _c_to_f(ndbc_res.get("water_temp")),
                "sources": {
                    "coops_station": stations["coops"],
                    "ndbc_station": stations["ndbc"],
                },
            }

    result = {"assets": asset_data, "updated_at": time.time()}
    _cache[f"live_{org_id}"] = {"ts": time.time(), "data": result}
    return result


@router.get("/history")
async def get_sensor_history(
    asset_id: int = Query(...),
    sensor_type: str = Query(..., description="air_temperature, wind, water_level"),
    start: str = Query(..., description="YYYYMMDD"),
    end: str = Query(..., description="YYYYMMDD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Historical NOAA CO-OPS data for an asset."""
    stations = _get_stations(asset_id)

    async with httpx.AsyncClient() as client:
        data = await fetch_coops_range(
            client, stations["coops"], start, end, sensor_type
        )

    return {
        "asset_id": asset_id,
        "sensor_type": sensor_type,
        "station": stations["coops"],
        "start": start,
        "end": end,
        "readings": data,
    }
