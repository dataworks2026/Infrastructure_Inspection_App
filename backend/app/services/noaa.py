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
    try:
        r = await client.get(COOPS_BASE, params=params, timeout=10)
        r.raise_for_status()
        data = r.json().get("data", [])
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
    try:
        r = await client.get(COOPS_BASE, params=params, timeout=15)
        r.raise_for_status()
        return r.json().get("data", [])
    except Exception:
        return []


def _safe_float(val: str) -> float | None:
    """Parse float, return None for missing/bad values (NDBC uses 99/999)."""
    try:
        f = float(val)
        return None if f >= 99.0 and val.replace(".", "").replace("-", "").isdigit() and f in (99.0, 999.0, 9999.0) else f
    except (ValueError, TypeError):
        return None


async def fetch_ndbc_latest(
    client: httpx.AsyncClient,
    station_id: str = DEFAULT_NDBC_STATION,
) -> dict:
    """Fetch latest buoy observation from NDBC realtime2 text file."""
    url = f"{NDBC_BASE}/{station_id}.txt"
    try:
        r = await client.get(url, timeout=10)
        r.raise_for_status()
        lines = r.text.strip().split("\n")
        if len(lines) < 3:
            return {"wave_height": None, "wave_period": None, "wind_speed": None, "wind_gust": None}

        headers = lines[0].replace("#", "").split()
        # Skip units row (line 1), data starts at line 2
        values = lines[2].split()

        row = dict(zip(headers, values))
        return {
            "wave_height": _safe_float(row.get("WVHT")),      # meters
            "wave_period": _safe_float(row.get("DPD")),        # seconds
            "wind_speed": _safe_float(row.get("WSPD")),        # m/s
            "wind_gust": _safe_float(row.get("GST")),          # m/s
            "wind_direction": _safe_float(row.get("WDIR")),    # degrees
            "air_temp": _safe_float(row.get("ATMP")),          # celsius
            "water_temp": _safe_float(row.get("WTMP")),        # celsius
            "station": station_id,
        }
    except Exception:
        return {
            "wave_height": None, "wave_period": None,
            "wind_speed": None, "wind_gust": None,
            "wind_direction": None, "air_temp": None, "water_temp": None,
            "station": station_id,
        }
