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
    fetch_ndbc_range,
    DEFAULT_COOPS_STATION,
    DEFAULT_NDBC_STATION,
)

router = APIRouter()

# ── In-memory cache (5-min TTL) ─────────────────────────────
_cache: dict[str, dict] = {}
CACHE_TTL = 300

# Station mapping per asset (could later come from DB)
ASSET_STATIONS = {
    "default": {
        "coops": DEFAULT_COOPS_STATION,  # The Battery, NY
        "ndbc": DEFAULT_NDBC_STATION,    # NY Harbor Entrance
    }
}


def _get_stations(asset_id) -> dict:
    return ASSET_STATIONS.get(str(asset_id), ASSET_STATIONS["default"])


def _ms_to_mph(ms: float | None) -> float | None:
    return round(ms * 2.23694, 1) if ms is not None else None


def _ms_to_kn(ms: float | None) -> float | None:
    return round(ms * 1.94384, 1) if ms is not None else None


def _c_to_f(c: float | None) -> float | None:
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

            # Fetch CO-OPS (temp + water level) and NDBC (wind + waves) in parallel
            # Wind is NOT available at CO-OPS 8518750, so we use NDBC buoy for wind
            temp_res, water_res, ndbc_res = await asyncio.gather(
                fetch_coops_latest(client, stations["coops"], "air_temperature"),
                fetch_coops_latest(client, stations["coops"], "water_level"),
                fetch_ndbc_latest(client, stations["ndbc"]),
            )

            # Parse CO-OPS air temperature
            temp_val = None
            if temp_res["value"]:
                try:
                    temp_val = float(temp_res["value"]["v"])
                except (ValueError, TypeError, KeyError):
                    pass

            # Parse CO-OPS water level
            water_level = None
            if water_res["value"]:
                try:
                    water_level = float(water_res["value"]["v"])
                except (ValueError, TypeError, KeyError):
                    pass

            asset_data[a.id] = {
                "asset_name": a.name,
                "location_name": a.location_name,
                "latitude": a.latitude,
                "longitude": a.longitude,
                "temperature_f": temp_val,
                "water_level_ft": water_level,
                # Wind from NDBC buoy (converted from m/s)
                "wind_speed_kn": _ms_to_kn(ndbc_res.get("wind_speed")),
                "wind_direction_deg": ndbc_res.get("wind_direction"),
                "wind_gust_kn": _ms_to_kn(ndbc_res.get("wind_gust")),
                "wind_speed_mph": _ms_to_mph(ndbc_res.get("wind_speed")),
                # Waves from NDBC buoy
                "wave_height_m": ndbc_res.get("wave_height"),
                "wave_period_s": ndbc_res.get("wave_period"),
                # Temps
                "water_temp_f": _c_to_f(ndbc_res.get("water_temp")),
                "air_temp_ndbc_f": _c_to_f(ndbc_res.get("air_temp")),
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
    asset_id: str = Query(...),
    sensor_type: str = Query(..., description="air_temperature, wind, water_level"),
    start: str = Query(..., description="YYYYMMDD"),
    end: str = Query(..., description="YYYYMMDD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Historical NOAA data for an asset. Wind uses NDBC, others use CO-OPS."""
    stations = _get_stations(asset_id)

    async with httpx.AsyncClient() as client:
        if sensor_type == "wind":
            # Wind history from NDBC buoy (CO-OPS 8518750 has no wind)
            data = await fetch_ndbc_range(client, stations["ndbc"], start, end)
            station = stations["ndbc"]
        else:
            data = await fetch_coops_range(
                client, stations["coops"], start, end, sensor_type
            )
            station = stations["coops"]

    return {
        "asset_id": asset_id,
        "sensor_type": sensor_type,
        "station": station,
        "start": start,
        "end": end,
        "readings": data,
    }
