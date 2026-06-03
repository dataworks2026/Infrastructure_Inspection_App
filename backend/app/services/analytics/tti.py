# Time to Intervention (TTI) — estimates how many days
# until each asset reaches its critical severity threshold
# based on its current deterioration rate.

# Logic:
#   TTI (years) = (critical_threshold - current_severity)
#                  / severity_change_rate
#   TTI (days)  = TTI (years) * 365

# Special cases handled:
#   - Asset already at or above critical threshold → TTI = 0
#   - Asset improving or stable → TTI = Not applicable
#   - Rate too low to project reliably → TTI = Not applicable
#   - Single inspection (no rate) → TTI = Not applicable


import pandas as pd


# TTI label thresholds in days
TTI_LABELS = [
    (0,    0,    'Immediate'),       # already at critical
    (1,    90,   'Near-term'),       # within 3 months
    (91,   365,  'Medium-term'),     # 3 months to 1 year
    (366,  1825, 'Long-term'),       # 1 to 5 years
]
TTI_LABEL_DEFAULT = 'Not applicable'


def calculate_tti(
    deterioration_df: pd.DataFrame,
    config          : dict
) -> pd.DataFrame:
    """
    Estimates Time to Intervention (TTI) per asset.

    Parameters:
        deterioration_df (pd.DataFrame): Output from deterioration module.
                                         Must contain: asset_id, asset_type,
                                         latest_severity, severity_change_rate.
        config           (dict): Loaded thresholds config from thresholds.yaml.

    Returns:
        pd.DataFrame: One row per asset with TTI estimate.
    """

    results = []

    for _, row in deterioration_df.iterrows():

        asset_id   = row['asset_id']
        asset_name = row['asset_name']
        asset_type = row['asset_type']
        current_severity  = row['latest_severity']
        rate_per_year     = row['severity_change_rate']
        inspection_count  = row['inspection_count']

        # ── Get TTI config for this asset type ────────────
        asset_config       = config.get(asset_type, config.get('default', {}))
        critical_threshold = asset_config.get('tti_critical_threshold', 4)
        min_rate           = asset_config.get('tti_min_rate_per_year', 0.1)

        # ── Case 1: Already at or above critical ──────────
        # Only flag Immediate if worsening or stable.
        # If the asset is improving, it is recovering — not applicable.
        if current_severity >= critical_threshold:
            if rate_per_year < 0:
                results.append(_build_row(
                    asset_id, asset_name, asset_type,
                    current_severity, critical_threshold,
                    rate_per_year, None, TTI_LABEL_DEFAULT,
                    'Asset is at critical threshold but improving — monitoring advised'
                ))
            else:
                results.append(_build_row(
                    asset_id, asset_name, asset_type,
                    current_severity, critical_threshold,
                    rate_per_year, 0, 'Immediate',
                    'Asset is already at or above critical threshold'
                ))
            continue

        # ── Case 2: Not enough inspections ────────────────
        if inspection_count < 2:
            results.append(_build_row(
                asset_id, asset_name, asset_type,
                current_severity, critical_threshold,
                rate_per_year, None, TTI_LABEL_DEFAULT,
                'Insufficient inspection history for projection'
            ))
            continue

        # ── Case 3: Improving or stable — not applicable ──
        if rate_per_year <= 0:
            results.append(_build_row(
                asset_id, asset_name, asset_type,
                current_severity, critical_threshold,
                rate_per_year, None, TTI_LABEL_DEFAULT,
                'Asset is stable or improving — no intervention projected'
            ))
            continue

        # ── Case 4: Rate too low to project reliably ──────
        if rate_per_year < min_rate:
            results.append(_build_row(
                asset_id, asset_name, asset_type,
                current_severity, critical_threshold,
                rate_per_year, None, TTI_LABEL_DEFAULT,
                f'Deterioration rate ({round(rate_per_year, 3)}/yr) below '
                f'minimum projection threshold ({min_rate}/yr)'
            ))
            continue

        # ── Case 5: Project TTI ────────────────────────────
        severity_gap  = critical_threshold - current_severity
        tti_years     = severity_gap / rate_per_year
        tti_days      = round(tti_years * 365)
        tti_label     = _classify_tti(tti_days)

        results.append(_build_row(
            asset_id, asset_name, asset_type,
            current_severity, critical_threshold,
            rate_per_year, tti_days, tti_label,
            f'Projected to reach severity {critical_threshold} '
            f'in ~{tti_days} days at current rate '
            f'({round(rate_per_year, 3)}/yr)'
        ))

    result_df = pd.DataFrame(results)

    # ── Summary print ─────────────────────────────────────
    immediate = (result_df['tti_label'] == 'Immediate').sum()
    near_term = (result_df['tti_label'] == 'Near-term').sum()
    print(
        f"[tti] TTI calculated for {len(result_df)} assets. "
        f"{immediate} require immediate intervention, "
        f"{near_term} near-term."
    )

    return result_df


def _classify_tti(tti_days: int) -> str:
    """
    Converts TTI in days to a human-readable urgency label.
    """
    if tti_days <= 0:
        return 'Immediate'
    for low, high, label in TTI_LABELS[1:]:
        if low <= tti_days <= high:
            return label
    return 'Long-term'


def _build_row(
    asset_id, asset_name, asset_type,
    current_severity, critical_threshold,
    rate_per_year, tti_days, tti_label, tti_note
) -> dict:
    return {
        'asset_id'           : asset_id,
        'asset_name'         : asset_name,
        'asset_type'         : asset_type,
        'current_severity'   : current_severity,
        'critical_threshold' : critical_threshold,
        'rate_per_year'      : rate_per_year,
        'tti_days'           : tti_days,
        'tti_label'          : tti_label,
        'tti_note'           : tti_note,
    }
