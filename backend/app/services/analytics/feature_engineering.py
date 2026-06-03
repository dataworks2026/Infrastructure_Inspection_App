"""
forecasting/feature_engineering.py
------------------------------------
Builds the feature matrix from the master training table.

Features are split into two categories:

CORE FEATURES (always available, required for model to run):
  - Severity history: current severity, lag features, rolling stats
  - Inspection timing: gap between inspections, asset age, inspection count
  - Asset characteristics: infrastructure type, risk category, elevation
  - Detection-derived signals: detection count, unique damage types,
    avg confidence, immediate repairs (produced by M1/M2 pipeline)
  - Damage progression signals: severity change rate, acceleration,
    area growth rate (produced by M1/M2 pipeline)
  - Inspection context: inspection type, inspection method

PLACEHOLDER FEATURES (optional, nullable):
  - Environmental: ph_environmental_exposure
  - Structural:    ph_structural_loading
  - Age context:   ph_age_factor
  - Maintenance:   ph_maintenance_history
  - Risk scores:   risk_score_max, risk_30_days, risk_90_days

  When these fields are absent or NaN, the pipeline runs cleanly
  using only core features. As new data sources are connected,
  these fields can be populated without any structural changes.

Usage:
    from forecasting.feature_engineering import build_feature_matrix
    X, y, meta = build_feature_matrix(master_df)
"""

import pandas as pd
import numpy as np


# ── Feature name lists ────────────────────────────────────────────────────────

CORE_FEATURES = [
    # Severity history
    'current_severity',
    'severity_lag1',
    'severity_lag2',
    'severity_rolling_mean2',
    'severity_rolling_max2',
    'severity_delta',
    'severity_delta_lag1',

    # Inspection timing
    'inspection_gap_days',
    'asset_age_days',
    'inspection_count_sofar',
    'days_since_first_inspection',

    # Asset characteristics (encoded)
    'infra_type_enc',
    'risk_category_enc',
    'elevation_ft',
    'inspection_frequency_days',

    # Inspection context (encoded)
    'inspection_type_enc',
    'inspection_method_enc',

    # Detection-derived signals (M1/M2 outputs)
    'det_count',
    'mean_severity_det',
    'unique_damage_types',
    'avg_confidence',
    'immediate_repairs',

    # Damage progression signals (M1/M2 outputs)
    'dp_severity_change_rate_max',
    'dp_acceleration_any',
    'dp_area_growth_max',
    'dp_unique_damage_types',
]

PLACEHOLDER_FEATURES = [
    # Environmental / structural context — optional, nullable
    # Populated when real data becomes available
    'ph_environmental_exposure',   # environmental stress level (0–1)
    'ph_structural_loading',       # structural load factor (0–1)
    'ph_age_factor',               # age-adjusted deterioration factor (0–1)
    'ph_maintenance_history',      # maintenance quality score (0–1)
    'risk_score_max',              # composite risk score from assessment
    'risk_30_days',                # projected risk at 30 days
    'risk_90_days',                # projected risk at 90 days
]

ALL_FEATURES = CORE_FEATURES + PLACEHOLDER_FEATURES

# Ordinal encodings (stable, explicit — no fit-time leakage)
INFRA_TYPE_ENC = {
    'pier': 1, 'coastal': 2, 'breakwater': 3,
    'offshore': 4, 'bridge': 5, 'pipeline': 6
}
RISK_CAT_ENC = {'low': 1, 'medium': 2, 'high': 3}
INSPECTION_TYPE_ENC = {
    'baseline': 1, 'routine': 2, 'pre-storm': 3,
    'post-storm': 4, 'follow-up': 5, 'emergency': 6
}
INSPECTION_METHOD_ENC = {
    'drone': 1, 'manual': 2, 'rope-access': 3,
    'ROV': 4, 'dive': 5
}


# ── Core feature construction ─────────────────────────────────────────────────

def _add_severity_features(df: pd.DataFrame) -> pd.DataFrame:
    """Lag, rolling, and delta features derived from severity history."""
    g = df.groupby('asset_id')

    df['current_severity']      = df['max_severity_det']
    df['severity_lag1']         = g['max_severity_det'].shift(1)
    df['severity_lag2']         = g['max_severity_det'].shift(2)
    df['severity_delta']        = g['max_severity_det'].diff()
    df['severity_delta_lag1']   = g['max_severity_det'].diff().shift(1)

    df['severity_rolling_mean2'] = g['max_severity_det'].transform(
        lambda x: x.shift(1).rolling(2, min_periods=1).mean()
    )
    df['severity_rolling_max2'] = g['max_severity_det'].transform(
        lambda x: x.shift(1).rolling(2, min_periods=1).max()
    )
    return df


def _add_timing_features(df: pd.DataFrame) -> pd.DataFrame:
    """Inspection timing and asset age features."""
    g = df.groupby('asset_id')

    df['inspection_gap_days'] = g['inspection_date'].diff().dt.days
    df['asset_age_days']      = (
        df['inspection_date'] - df['installation_date']
    ).dt.days
    df['inspection_count_sofar'] = g.cumcount() + 1

    first_insp = g['inspection_date'].transform('min')
    df['days_since_first_inspection'] = (
        df['inspection_date'] - first_insp
    ).dt.days

    return df


def _add_encoded_categoricals(df: pd.DataFrame) -> pd.DataFrame:
    """Ordinal encode categorical fields."""
    df['infra_type_enc']       = df['infrastructure_type'].map(INFRA_TYPE_ENC).fillna(0).astype(int)
    df['risk_category_enc']    = df['risk_category'].map(RISK_CAT_ENC).fillna(0).astype(int)
    df['inspection_type_enc']  = df['inspection_type'].map(INSPECTION_TYPE_ENC).fillna(0).astype(int)
    df['inspection_method_enc']= df['inspection_method'].map(INSPECTION_METHOD_ENC).fillna(0).astype(int)
    return df


# ── Placeholder field schema ──────────────────────────────────────────────────

def _ensure_placeholder_columns(df: pd.DataFrame) -> pd.DataFrame:
    """
    Ensure placeholder columns exist in the dataframe.
    If already present (e.g. from risk_assessments join), keep as-is.
    If absent, add as NaN columns.
    The model handles NaN placeholder features natively (LightGBM supports this).
    """
    for col in PLACEHOLDER_FEATURES:
        if col not in df.columns:
            df[col] = np.nan
    return df


# ── Main entry point ──────────────────────────────────────────────────────────

def build_feature_matrix(
    master_df: pd.DataFrame,
    use_placeholders: bool = True,
) -> tuple[pd.DataFrame, pd.Series, pd.DataFrame]:
    """
    Build the feature matrix from the master training table.

    Parameters
    ----------
    master_df : pd.DataFrame
        Output of data_pipeline.build_master_table().
    use_placeholders : bool
        If True, include placeholder feature columns in X (as NaN where missing).
        If False, use core features only.

    Returns
    -------
    X : pd.DataFrame
        Feature matrix (training rows only — has_target == True).
    y : pd.Series
        Target variable (target_severity_next).
    meta : pd.DataFrame
        Metadata columns for traceability: asset_id, asset_name,
        inspection_date, inspection_id.
    """
    df = master_df.copy()
    df = df.sort_values(['asset_id', 'inspection_date']).reset_index(drop=True)

    print('[feature_engineering] Building severity features...')
    df = _add_severity_features(df)

    print('[feature_engineering] Building timing features...')
    df = _add_timing_features(df)

    print('[feature_engineering] Encoding categoricals...')
    df = _add_encoded_categoricals(df)

    print('[feature_engineering] Checking placeholder columns...')
    df = _ensure_placeholder_columns(df)

    # ── Select feature columns ─────────────────────────────────────────────
    feature_cols = CORE_FEATURES + (PLACEHOLDER_FEATURES if use_placeholders else [])

    # ── Filter to training rows only (rows with a valid target) ───────────
    train_df = df[df['has_target']].copy()

    X    = train_df[feature_cols].copy()
    y    = train_df['target_severity_next'].astype(int)
    meta = train_df[['asset_id', 'asset_name', 'inspection_date', 'id']].rename(
        columns={'id': 'inspection_id'}
    )

    print(f'[feature_engineering] Feature matrix: {X.shape[0]} rows x {X.shape[1]} features')
    print(f'[feature_engineering] Core features: {len(CORE_FEATURES)} | '
          f'Placeholder features: {len(PLACEHOLDER_FEATURES) if use_placeholders else 0}')

    # ── Null audit ─────────────────────────────────────────────────────────
    null_counts = X[CORE_FEATURES].isnull().sum()
    null_core   = null_counts[null_counts > 0]
    if not null_core.empty:
        print('[feature_engineering] NaN in core features (expected for lag/rolling on first inspections):')
        print(null_core.to_string())

    return X, y, meta


def get_feature_names(use_placeholders: bool = True) -> list[str]:
    """Return the ordered list of feature names used in training."""
    return CORE_FEATURES + (PLACEHOLDER_FEATURES if use_placeholders else [])


if __name__ == '__main__':
    import sys
    from app.services.analytics.data_pipeline import build_master_table

    data_dir = sys.argv[1] if len(sys.argv) > 1 else 'data/'
    master_df = build_master_table(data_dir=data_dir)

    X, y, meta = build_feature_matrix(master_df)
    print('\nFeature matrix sample:')
    print(X.head(5).to_string())
    print('\nTarget distribution:')
    print(y.value_counts().sort_index())
