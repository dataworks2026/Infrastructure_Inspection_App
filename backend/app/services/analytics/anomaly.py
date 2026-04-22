# Detects unusual jumps in severity scores per asset.
# Two methods combined:
#   1. Absolute jump threshold (configurable per asset_type)
#   2. Statistical threshold (mean + N x std of asset history)

# Key rules:
#   - Only WORSENING jumps are flagged (positive changes)
#   - Statistical method requires minimum 3 inspections
#   - Improvements (negative changes) are never anomalies


import pandas as pd
import numpy as np


def detect_anomalies(
    df: pd.DataFrame,
    config: dict
) -> pd.DataFrame:
    """
    Detects anomalous severity jumps per asset per inspection.

    Parameters:
        df     (pd.DataFrame): Preprocessed dataframe from preprocessor.
        config (dict): Loaded thresholds config from thresholds.yaml.

    Returns:
        pd.DataFrame: One row per inspection with anomaly flag and reason.
    """

    results = []

    for asset_id, group in df.groupby('asset_id'):
        group = group.sort_values('inspection_date').reset_index(drop=True)

        asset_name = group['asset_name'].iloc[0]
        asset_type = group['asset_type'].iloc[0]
        scores     = group['severity_score'].tolist()
        dates      = group['inspection_date'].tolist()
        n          = len(scores)

        # Get config for this asset type 
        asset_config   = config.get(asset_type, config.get('default', {}))
        jump_threshold = asset_config.get('anomaly_jump_threshold', 2)
        std_multiplier = asset_config.get('anomaly_std_multiplier', 2.0)

        #  Calculate changes between inspections 
        # Positive = worsening, Negative = improving, Zero = stable
        changes = [0] + [scores[i] - scores[i-1] for i in range(1, n)]

        # Statistical baseline
        # Only use WORSENING changes (positive) for baseline.
        # Improvements should never inflate the threshold.
        # Also requires minimum 3 inspections for stat method.
        worsening_changes = [c for c in changes[1:] if c > 0]
        use_stat_method   = n >= 3 and len(worsening_changes) >= 2

        if use_stat_method:
            mean_change    = np.mean(worsening_changes)
            std_change     = np.std(worsening_changes)
            stat_threshold = mean_change + std_multiplier * std_change
        else:
            mean_change    = 0
            std_change     = 0
            stat_threshold = None

        for i, (date, score, change) in enumerate(
            zip(dates, scores, changes)
        ):
            anomaly_flag   = False
            anomaly_reason = None

            # First inspection — no previous to compare
            if i == 0:
                results.append(_build_row(
                    asset_id, asset_name, asset_type,
                    date, score, change,
                    False, None,
                    jump_threshold, std_multiplier
                ))
                continue

            #  Only flag WORSENING changes
            # Improvements and stable readings are never anomalies
            if change <= 0:
                results.append(_build_row(
                    asset_id, asset_name, asset_type,
                    date, score, change,
                    False, None,
                    jump_threshold, std_multiplier
                ))
                continue

            # Method 1: Absolute jump 
            # Flag if severity jumps by jump_threshold or more
            if change >= jump_threshold:
                anomaly_flag   = True
                anomaly_reason = (
                    f"Severity jumped by {change} "
                    f"{'level' if change == 1 else 'levels'} "
                    f"(threshold: {jump_threshold})"
                )

            # Method 2: Statistical jump 
            # Only runs if we have enough history AND
            # the absolute method did not already flag it
            elif use_stat_method and std_change > 0 and change > stat_threshold:
                anomaly_flag   = True
                anomaly_reason = (
                    f"Jump of {change} exceeds statistical threshold "
                    f"of {round(stat_threshold, 2)} "
                    f"(mean worsening={round(mean_change, 2)}, "
                    f"std={round(std_change, 2)})"
                )

            results.append(_build_row(
                asset_id, asset_name, asset_type,
                date, score, change,
                anomaly_flag, anomaly_reason,
                jump_threshold, std_multiplier
            ))

    result_df = pd.DataFrame(results)
    flagged   = result_df['anomaly_flag'].sum()
    print(
        f"[anomaly] Scanned {len(result_df)} inspection records. "
        f"{flagged} anomalies detected."
    )
    return result_df


def get_asset_anomaly_summary(anomaly_df: pd.DataFrame) -> pd.DataFrame:
    """
    Summarises anomaly results at asset level.
    Returns one row per asset with anomaly count and flag.
    """
    records = []
    for asset_id, group in anomaly_df.groupby('asset_id'):
        flagged = group[group['anomaly_flag'] == True]
        records.append({
            'asset_id'          : asset_id,
            'asset_name'        : group['asset_name'].iloc[0],
            'asset_type'        : group['asset_type'].iloc[0],
            'total_inspections' : len(group),
            'anomaly_count'     : len(flagged),
            'has_anomaly'       : len(flagged) > 0,
            'latest_anomaly_date': flagged['inspection_date'].max()
                                   if len(flagged) > 0 else None
        })
    return pd.DataFrame(records)


def _build_row(
    asset_id, asset_name, asset_type,
    date, score, change,
    anomaly_flag, anomaly_reason,
    jump_threshold, std_multiplier
) -> dict:
    return {
        'asset_id'           : asset_id,
        'asset_name'         : asset_name,
        'asset_type'         : asset_type,
        'inspection_date'    : date,
        'severity_score'     : score,
        'severity_change'    : change,
        'anomaly_flag'       : anomaly_flag,
        'anomaly_reason'     : anomaly_reason,
        'jump_threshold_used': jump_threshold,
        'std_multiplier_used': std_multiplier,
    }