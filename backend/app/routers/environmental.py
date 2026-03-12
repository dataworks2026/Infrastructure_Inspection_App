"""Live environmental data for asset locations via Open-Meteo APIs."""

import time
import httpx
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.deps import get_db, get_current_user
from app.models.user import User
from app.models.asset import Asset

router = APIRouter()

# ── In-memory cache (5-min TTL per org) ─────────────────────────────────────
_cache: dict[str, dict] = {}  # key = org_id, value = {"ts": float, "data": dict}
CACHE_TTL = 300  # seconds


async def _fetch_weather(client: httpx.AsyncClient, lat: float, lng: float) -> dict:
    """Fetch current temperature + wind from Open-Meteo Weather API."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": round(lat, 4),
        "longitude": round(lng, 4),
        "current": "temperature_2m,wind_speed_10m,wind_direction_10m",
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "timezone": "auto",
    }
    try:
        r = await client.get(url, params=params, timeout=10)
        r.raise_for_status()
        c = r.json().get("current", {})
        return {
            "temperature": c.get("temperature_2m"),
            "wind_speed": c.get("wind_speed_10m"),
            "wind_direction": c.get("wind_direction_10m"),
        }
    except Exception:
        return {"temperature": None, "wind_speed": None, "wind_direction": None}


async def _fetch_marine(client: httpx.AsyncClient, lat: float, lng: float) -> dict:
    """Fetch current wave height + period from Open-Meteo Marine API."""
    url = "https://marine-api.open-meteo.com/v1/marine"
    params = {
        "latitude": round(lat, 4),
        "longitude": round(lng, 4),
        "current": "wave_height,wave_period,wave_direction",
    }
    try:
        r = await client.get(url, params=params, timeout=10)
        r.raise_for_status()
        c = r.json().get("current", {})
        return {
            "wave_height": c.get("wave_height"),
            "wave_period": c.get("wave_period"),
            "wave_direction": c.get("wave_direction"),
        }
    except Exception:
        return {"wave_height": None, "wave_period": None, "wave_direction": None}


@router.get("/assets")
async def get_environmental_data(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = current_user.organization_id

    # Check cache
    cached = _cache.get(org_id)
    if cached and (time.time() - cached["ts"]) < CACHE_TTL:
        return cached["data"]

    # Fetch assets with coordinates
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
        _cache[org_id] = {"ts": time.time(), "data": result}
        return result

    # Fetch data for all assets in parallel
    import asyncio

    asset_data = {}
    async with httpx.AsyncClient() as client:
        tasks = []
        for a in assets:
            tasks.append((a.id, a.name, a.latitude, a.longitude, a.location_name))

        async def fetch_one(asset_id, name, lat, lng, loc_name):
            weather, marine = await asyncio.gather(
                _fetch_weather(client, lat, lng),
                _fetch_marine(client, lat, lng),
            )
            return asset_id, {
                "asset_name": name,
                "location_name": loc_name,
                "latitude": lat,
                "longitude": lng,
                "temperature": weather["temperature"],
                "wind_speed": weather["wind_speed"],
                "wind_direction": weather["wind_direction"],
                "wave_height": marine["wave_height"],
                "wave_period": marine["wave_period"],
                "wave_direction": marine["wave_direction"],
            }

        results = await asyncio.gather(
            *[fetch_one(a_id, nm, lt, lg, ln) for a_id, nm, lt, lg, ln in tasks]
        )
        for asset_id, data in results:
            asset_data[asset_id] = data

    result = {"assets": asset_data, "updated_at": time.time()}
    _cache[org_id] = {"ts": time.time(), "data": result}
    return result
