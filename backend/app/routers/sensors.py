"""Sensors API — live + historical NOAA data for asset locations."""

from __future__ import annotations

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

# NOAA station catalog with approximate coordinates, used to pick the station
# nearest to each asset instead of hardcoding one location. CO-OPS = tide /
# water-level / air-temp; NDBC = wind / wave buoys. Falls back to the NY Harbor
# defaults when an asset has no coordinates.
COOPS_STATIONS = [
    ("8518750", 40.700, -74.014),  # The Battery, NY
    ("8516945", 40.810, -73.765),  # Kings Point, NY
    ("8519483", 40.639, -74.146),  # Bergen Point West Reach, NY
    ("8531680", 40.467, -74.009),  # Sandy Hook, NJ
    ("8467150", 41.173, -73.182),  # Bridgeport, CT
    ("8534720", 39.355, -74.418),  # Atlantic City, NJ
    ("8443970", 42.354, -71.050),  # Boston, MA
    ("8557380", 38.782, -75.119),  # Lewes, DE
    ("8638610", 36.947, -76.330),  # Sewells Point, VA
]
NDBC_STATIONS = [
    ("44065", 40.369, -73.703),  # NY Harbor Entrance
    ("44025", 40.251, -73.164),  # Long Island
    ("44013", 42.346, -70.651),  # Boston
    ("44009", 38.457, -74.702),  # Delaware Bay
    ("44014", 36.611, -74.842),  # Virginia Beach
]


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Relative great-circle distance (radians); good enough for nearest-picking."""
    from math import radians, sin, cos, asin, sqrt

    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * asin(sqrt(a))


def _nearest(catalog: list, lat, lon, default: str) -> str:
    if lat is None or lon is None:
        return default
    return min(catalog, key=lambda s: _haversine(lat, lon, s[1], s[2]))[0]


def _get_stations(lat=None, lon=None) -> dict:
    """Nearest CO-OPS + NDBC stations to the given coordinates."""
    return {
        "coops": _nearest(COOPS_STATIONS, lat, lon, DEFAULT_COOPS_STATION),
        "ndbc": _nearest(NDBC_STATIONS, lat, lon, DEFAULT_NDBC_STATION),
    }


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
            stations = _get_stations(a.latitude, a.longitude)

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
    sensor_type: str = Query(..., description="air_temperature, wind, water_level, wave_height"),
    start: str = Query(..., description="YYYYMMDD"),
    end: str = Query(..., description="YYYYMMDD"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Historical NOAA data for an asset. Wind uses NDBC, others use CO-OPS."""
    asset = (
        db.query(Asset.latitude, Asset.longitude)
        .filter(Asset.id == asset_id, Asset.organization_id == current_user.organization_id)
        .first()
    )
    stations = _get_stations(
        asset.latitude if asset else None,
        asset.longitude if asset else None,
    )

    async with httpx.AsyncClient() as client:
        if sensor_type in ("wind", "wave_height"):
            # Wind + wave history from NDBC buoy
            data = await fetch_ndbc_range(client, stations["ndbc"], start, end, field=sensor_type)
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
