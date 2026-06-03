
# Calculates a priority score (0-100) for each asset.
# Combines four components:
#   1. Latest severity
#   2. Deterioration rate (time-normalised, per year)
#   3. Anomaly flag
#   4. Historical max severity (decay-weighted)

# All weights are configurable per asset_type in thresholds.yaml.

# Decay rule: older high-severity states carry less weight
# than recent ones, so assets that have genuinely recovered
# are not permanently penalised by historical peaks.

# Floor rule: any asset at latest severity 4 scores minimum 60.


import pandas as pd
import numpy as np


# Constants
MAX_SEVERITY     = 4.0
MAX_RATE         = 2.0    # cap for time-normalised rate (per year)
SEVERITY_4_FLOOR = 60.0


def calculate_priority(
    deterioration_df : pd.DataFrame,
    anomaly_df       : pd.DataFrame,
    clean_df         : pd.DataFrame,
    config           : dict
) -> pd.DataFrame:
    """
    Calculates a priority score (0-100) for each asset.

    Parameters:
        deterioration_df (pd.DataFrame): Output from deterioration module.
        anomaly_df       (pd.DataFrame): Output from anomaly module.
        clean_df         (pd.DataFrame): Preprocessed inspection data
                                         (needed for decay calculation).
        config           (dict): Loaded thresholds config.

    Returns:
        pd.DataFrame: One row per asset with priority score and label.
    """

    # ── Get one anomaly flag per asset ────────────────────
    anomaly_summary = anomaly_df.groupby('asset_id').agg(
        has_anomaly=('anomaly_flag', 'any')
    ).reset_index()

    # ── Merge deterioration + anomaly ─────────────────────
    df = deterioration_df.merge(anomaly_summary, on='asset_id', how='left')
    df['has_anomaly'] = df['has_anomaly'].fillna(False)

    results = []

    for _, row in df.iterrows():

        asset_id   = row['asset_id']
        asset_type = row['asset_type']

        # ── Get weights for this asset type ───────────────
        asset_config    = config.get(asset_type, config.get('default', {}))
        weights         = asset_config.get('priority_weights', {})
        decay_lambda    = asset_config.get('historical_decay_lambda', 0.5)

        w_severity      = weights.get('current_severity',      0.40)
        w_deterioration = weights.get('deterioration_rate',    0.30)
        w_anomaly       = weights.get('anomaly_flag',          0.15)
        w_hist_max      = weights.get('historical_max_severity', 0.15)

        # ── Component 1: Latest severity ──────────────────
        norm_severity = row['latest_severity'] / MAX_SEVERITY

        # ── Component 2: Deterioration rate ───────────────
        # Clipped at MAX_RATE, floor at 0 (improving = 0 urgency)
        norm_rate = max(0, min(row['severity_change_rate'], MAX_RATE)) / MAX_RATE

        # ── Component 3: Anomaly flag ─────────────────────
        norm_anomaly = 1.0 if row['has_anomaly'] else 0.0

        # ── Component 4: Decay-weighted historical max ────
        # Recent high-severity readings count more than old ones.
        # decay_lambda controls how fast old data fades:
        #   0.5 = ~60% weight loss per year (default)
        #   1.0 = ~63% weight loss per year (faster decay)
        #   0.2 = ~18% weight loss per year (slower decay)
        norm_hist_max = _decay_weighted_max(
            clean_df, asset_id, decay_lambda, MAX_SEVERITY
        )

        # ── Weighted priority score ────────────────────────
        raw_score = (
            w_severity      * norm_severity  +
            w_deterioration * norm_rate      +
            w_anomaly       * norm_anomaly   +
            w_hist_max      * norm_hist_max
        )

        priority_score = round(raw_score * 100, 2)

        # ── Severity 4 floor ──────────────────────────────
        if row['latest_severity'] == 4:
            priority_score = max(priority_score, SEVERITY_4_FLOOR)

        priority_label = _classify_priority(priority_score)

        results.append({
            'asset_id'            : asset_id,
            'asset_name'          : row['asset_name'],
            'asset_type'          : asset_type,
            'latest_severity'     : row['latest_severity'],
            'trend_direction'     : row['trend_direction'],
            'severity_change_rate': row['severity_change_rate'],
            'acceleration'        : row['acceleration'],
            'has_anomaly'         : row['has_anomaly'],
            'priority_score'      : priority_score,
            'priority_label'      : priority_label,
            'weight_severity'     : w_severity,
            'weight_deterioration': w_deterioration,
            'weight_anomaly'      : w_anomaly,
            'weight_hist_max'     : w_hist_max,
        })

    result_df = pd.DataFrame(results)

    # ── Sort by priority score descending ─────────────────
    result_df = result_df.sort_values(
        'priority_score', ascending=False
    ).reset_index(drop=True)

    result_df['priority_rank'] = result_df.index + 1

    print(f"[priority] Priority scores calculated for {len(result_df)} assets.")
    print(
        f"[priority] Top priority asset: "
        f"{result_df.iloc[0]['asset_name']} "
        f"(score: {result_df.iloc[0]['priority_score']})"
    )

    return result_df


def _decay_weighted_max(
    clean_df     : pd.DataFrame,
    asset_id     : str,
    decay_lambda : float,
    max_severity : float
) -> float:
    """
    Calculates decay-weighted historical max severity for one asset.

    Older high-severity readings are down-weighted exponentially.
    Formula: weight = exp(-lambda * years_ago)

    Returns normalised value between 0 and 1.
    """
    asset_data = clean_df[clean_df['asset_id'] == asset_id].copy()
    asset_data = asset_data.sort_values('inspection_date')

    if len(asset_data) == 0:
        return 0.0

    latest_date = asset_data['inspection_date'].max()

    weighted_scores = []
    for _, row in asset_data.iterrows():
        years_ago = (latest_date - row['inspection_date']).days / 365.25
        weight    = np.exp(-decay_lambda * years_ago)
        weighted_scores.append(row['severity_score'] * weight)

    decay_max = max(weighted_scores) if weighted_scores else 0.0
    return decay_max / max_severity


def _classify_priority(score: float) -> str:
    """
    Converts numeric priority score to a human-readable label.
    """
    if score >= 80:
        return 'Critical'
    elif score >= 60:
        return 'High'
    elif score >= 40:
        return 'Medium'
    elif score >= 20:
        return 'Low'
    else:
        return 'Minimal'
