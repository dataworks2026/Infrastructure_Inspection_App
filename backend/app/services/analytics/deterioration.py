
# Calculates deterioration rate and trend direction
# for each asset based on its severity history over time.

# severity_change_rate is time-normalised (per year)
# so irregular inspection intervals are handled correctly.


import pandas as pd
import numpy as np
from scipy import stats


def calculate_deterioration(df: pd.DataFrame) -> pd.DataFrame:
    """
    Calculates deterioration rate and trend direction per asset.

    Parameters:
        df (pd.DataFrame): Preprocessed dataframe from preprocessor.

    Returns:
        pd.DataFrame: One row per asset with deterioration metrics.
    """

    results = []

    for asset_id, group in df.groupby('asset_id'):
        group = group.sort_values('inspection_date').reset_index(drop=True)

        asset_name = group['asset_name'].iloc[0]
        asset_type = group['asset_type'].iloc[0]
        scores     = group['severity_score'].tolist()
        dates      = group['inspection_date'].tolist()
        n          = len(scores)

        # ── Minimum 2 inspections needed for trend ────────
        if n < 2:
            results.append(_single_inspection_result(
                asset_id, asset_name, asset_type, scores[0]
            ))
            continue

        # ── Step 1: Time-normalised slope ─────────────────
        # Convert inspection dates to years elapsed from first
        # inspection so rate is per year, not per cycle.
        # This handles irregular inspection intervals correctly.
        first_date    = dates[0]
        years_elapsed = [(d - first_date).days / 365.25 for d in dates]

        x = np.array(years_elapsed)
        y = np.array(scores)

        # Guard against all inspections on the same date
        if len(set(x)) > 1:
            slope, intercept, r_value, p_value, std_err = stats.linregress(x, y)
        else:
            slope, r_value = 0.0, 0.0

        # ── Step 2: Severity change per cycle ─────────────
        changes       = [scores[i] - scores[i-1] for i in range(1, n)]
        avg_change    = np.mean(changes)
        latest_change = changes[-1]

        # ── Step 3: Trend direction ────────────────────────
        trend = _classify_trend(slope, avg_change, scores)

        # ── Step 4: Acceleration detection ────────────────
        # Only applies to assets that are actually worsening.
        # Checks if the rate of worsening is itself increasing.
        acceleration = False
        if n >= 3 and slope > 0:
            half               = len(changes) // 2
            first_half_change  = np.mean(changes[:half]) if changes[:half] else 0
            second_half_change = np.mean(changes[half:]) if changes[half:] else 0
            if second_half_change > first_half_change + 0.3:
                acceleration = True

        results.append({
            'asset_id'            : asset_id,
            'asset_name'          : asset_name,
            'asset_type'          : asset_type,
            'inspection_count'    : n,
            'first_severity'      : scores[0],
            'latest_severity'     : scores[-1],
            'severity_change_rate': round(slope, 4),   # per year
            'avg_change_per_cycle': round(avg_change, 4),
            'latest_change'       : latest_change,
            'trend_direction'     : trend,
            'acceleration'        : acceleration,
            'r_squared'           : round(r_value ** 2, 4),
            'first_inspection'    : dates[0],
            'latest_inspection'   : dates[-1],
        })

    result_df = pd.DataFrame(results)
    print(f"[deterioration] Calculated deterioration for "
          f"{len(result_df)} assets. "
          f"(severity_change_rate = per year, time-normalised)")
    return result_df


def _classify_trend(slope: float, avg_change: float, scores: list) -> str:
    """
    Classifies trend direction based on slope and score pattern.

    Returns one of: 'worsening', 'accelerating', 'stable',
                    'improving', 'fluctuating'
    """
    changes = [scores[i] - scores[i-1] for i in range(1, len(scores))]

    # Fluctuating — alternating up and down pattern
    sign_changes = sum(
        1 for i in range(1, len(changes))
        if changes[i] * changes[i-1] < 0
    )
    if len(changes) >= 3 and sign_changes >= len(changes) - 1:
        return 'fluctuating'

    # Accelerating — worsening and speeding up (per year)
    if slope > 0.8:
        return 'accelerating'

    # Worsening — steadily going up
    if slope > 0.1:
        return 'worsening'

    # Improving — steadily going down
    if slope < -0.1:
        return 'improving'

    # Stable — little to no change
    return 'stable'


def _single_inspection_result(
    asset_id: str,
    asset_name: str,
    asset_type: str,
    severity: int
) -> dict:
    """
    Returns a default result for assets with only one inspection.
    Cannot calculate trend with a single data point.
    """
    return {
        'asset_id'            : asset_id,
        'asset_name'          : asset_name,
        'asset_type'          : asset_type,
        'inspection_count'    : 1,
        'first_severity'      : severity,
        'latest_severity'     : severity,
        'severity_change_rate': 0.0,
        'avg_change_per_cycle': 0.0,
        'latest_change'       : 0,
        'trend_direction'     : 'stable',
        'acceleration'        : False,
        'r_squared'           : 0.0,
        'first_inspection'    : None,
        'latest_inspection'   : None,
    }