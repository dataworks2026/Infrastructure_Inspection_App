"""NOAA government data services — CO-OPS (tides/weather) + NDBC (buoys)."""

import httpx

COOPS_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
NDBC_BASE = "https://www.ndbc.noaa.gov/data/realtime2"

# Default stations for Governor's Island / NY Harbor area
DEFAULT_COOPS_STATION = "8518750"  # The Battery, NY
DEFAULT_NDBC_STATION = "44065"    # NY Harbor Entrance


async def fetch_coops_latest(
    client: httpx.AsyncClient,
    station_id: str = DEFAULT_COOPS_STATION,
    product: str = "air_temperature",
) -> dict:
    """Fetch latest reading from NOAA CO-OPS for a single product."""
    params = {
        "station": station_id,
        "date": "latest",
        "product": product,
        "units": "english",
        "time_zone": "gmt",
        "format": "json",
        "application": "mira_intel",
    }
    # water_level requires a datum
    if product == "water_level":
        params["datum"] = "MLLW"
    try:
        r = await client.get(COOPS_BASE, params=params, timeout=10)
        r.raise_for_status()
        j = r.json()
        if "error" in j:
            return {"value": None, "station": station_id, "product": product}
        data = j.get("data", [])
        if data:
            return {"value": data[0], "station": station_id, "product": product}
    except Exception:
        pass
    return {"value": None, "station": station_id, "product": product}


async def fetch_coops_range(
    client: httpx.AsyncClient,
    station_id: str,
    begin_date: str,
    end_date: str,
    product: str = "air_temperature",
) -> list[dict]:
    """Fetch date range from CO-OPS. Dates as YYYYMMDD."""
    params = {
        "station": station_id,
        "begin_date": begin_date,
        "end_date": end_date,
        "product": product,
        "units": "english",
        "time_zone": "gmt",
        "format": "json",
        "application": "mira_intel",
    }
    if product == "water_level":
        params["datum"] = "MLLW"
    try:
        r = await client.get(COOPS_BASE, params=params, timeout=15)
        r.raise_for_status()
        j = r.json()
        if "error" in j:
            return []
        return j.get("data", [])
    except Exception:
        return []


def _safe_float(val: str) -> float | None:
    """Parse float, return None for missing/bad values (NDBC uses MM and 99/999)."""
    if val is None or val == "MM":
        return None
    try:
        f = float(val)
        if f in (99.0, 999.0, 9999.0):
            return None
        return f
    except (ValueError, TypeError):
        return None


async def fetch_ndbc_latest(
    client: httpx.AsyncClient,
    station_id: str = DEFAULT_NDBC_STATION,
) -> dict:
    """Fetch latest buoy observation from NDBC realtime2 text file.
    Scans up to 10 recent rows to find non-MM values for each field."""
    url = f"{NDBC_BASE}/{station_id}.txt"
    empty = {
        "wave_height": None, "wave_period": None,
        "wind_speed": None, "wind_gust": None,
        "wind_direction": None, "air_temp": None, "water_temp": None,
        "station": station_id,
    }
    try:
        r = await client.get(url, timeout=10)
        r.raise_for_status()
        lines = r.text.strip().split("\n")
        if len(lines) < 3:
            return empty

        headers = lines[0].replace("#", "").split()
        fields = {"WVHT": "wave_height", "DPD": "wave_period", "WSPD": "wind_speed",
                  "GST": "wind_gust", "WDIR": "wind_direction", "ATMP": "air_temp", "WTMP": "water_temp"}

        result = dict(empty)
        # Scan rows 2..11 (skip header + units) for first non-MM value per field
        for line in lines[2:12]:
            vals = line.split()
            row = dict(zip(headers, vals))
            for ndbc_key, out_key in fields.items():
                if result[out_key] is None:
                    result[out_key] = _safe_float(row.get(ndbc_key))
            # Stop early if all fields populated
            if all(result[k] is not None for k in fields.values()):
                break

        return result
    except Exception:
        return empty
