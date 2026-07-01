"""
forecast.py
-----------
Inference module for severity forecasting — backend integration.

Bridges the M2 LightGBM pipeline to the DataFrame produced by
build_analytics_dataframe() instead of reading from CSV files.

Returns a DataFrame with four new columns (V3 schema additions):
  forecast_severity_next  — predicted severity at next inspection (1-4)
  forecast_confidence     — High / Medium / Low
  forecast_horizon_days   — days until next expected inspection
  forecast_note           — plain-language interpretation

Graceful degradation: if the model file is missing, or feature
engineering fails for any reason, returns an empty DataFrame.
engine.py continues without forecast columns.
"""

import os
import warnings

import numpy as np
import pandas as pd

from app.services.analytics.lightgbm_model import LGBMForecaster
from app.services.analytics.feature_engineering import build_feature_matrix


# Severity label → integer mapping matching the standalone pipeline.
_SEV_MAP = {
    'S1': 1, 'S2': 2, 'S3': 3, 'S4': 4,
    '1': 1,  '2': 2,  '3': 3,  '4': 4,
     1: 1,    2: 2,    3: 3,    4: 4,
}

_DEFAULT_HORIZON_DAYS = 180

# Resolved once at import time so callers that never supply a
# model_path still find the file regardless of working directory.
_DEFAULT_MODEL_PATH = os.path.normpath(
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        '..', '..', '..', 'ml_models', 'forecast_model.pkl',
    )
)


# ── Master-table builder ──────────────────────────────────────────────────────

def _build_master_df(df: pd.DataFrame) -> pd.DataFrame:
    """
    Convert build_analytics_dataframe() output into the master_df
    shape that feature_engineering.build_feature_matrix() expects.

    build_analytics_dataframe() produces:
      asset_id, asset_name, asset_type, inspection_date, severity_score

    All columns required by feature engineering that are absent from
    the DB adapter output are filled with sensible defaults. As real
    data sources (risk assessments, maintenance records, structural
    loading) are connected, those columns can be supplied directly and
    the model will use them automatically without code changes.
    """
    df = df.copy()
    df['inspection_date'] = pd.to_datetime(df['inspection_date'])
    df = df.sort_values(['asset_id', 'inspection_date']).reset_index(drop=True)

    # Severity strings → integers
    df['max_severity_det']  = df['severity_score'].map(_SEV_MAP).fillna(2).astype(int)
    df['mean_severity_det'] = df['max_severity_det'].astype(float)

    # Synthetic installation date: first inspection minus 1 year per asset.
    # Replaced automatically once a real installation_date column exists.
    first_insp = df.groupby('asset_id')['inspection_date'].transform('min')
    df['installation_date'] = first_insp - pd.Timedelta(days=365)

    # Categorical defaults — lowercase so ordinal encoders in
    # feature_engineering match their lookup tables.
    df['infrastructure_type']       = df['asset_type'].str.lower().fillna('bridge')
    df['risk_category']             = 'medium'
    df['inspection_type']           = 'routine'
    df['inspection_method']         = 'drone'
    df['inspection_frequency_days'] = _DEFAULT_HORIZON_DAYS
    df['elevation_ft']              = 0.0

    # Detection-level aggregates — one detection per inspection is a
    # conservative default until real detection tables are wired in.
    df['det_count']           = 1
    df['unique_damage_types'] = 1
    df['avg_confidence']      = 0.8
    df['immediate_repairs']   = 0

    # Damage-progression signals — zeroed until the dp_* columns from
    # the real damage_progressions table are passed through.
    df['dp_severity_change_rate_max'] = 0.0
    df['dp_acceleration_any']         = 0
    df['dp_area_growth_max']          = 0.0
    df['dp_unique_damage_types']      = 0

    # Synthetic row id (integer index) — used only for traceability
    # in feature meta; does not affect model output.
    df['id'] = df.index.astype(int)

    # Target: severity of the NEXT inspection for the same asset.
    # Rows without a next inspection (the latest per asset) have
    # has_target=False; they are excluded from training but included
    # in inference via _get_latest_features().
    df['target_severity_next'] = (
        df.groupby('asset_id')['max_severity_det'].shift(-1)
    )
    df['has_target']           = df['target_severity_next'].notna()
    df['target_severity_next'] = df['target_severity_next'].fillna(0).astype(int)

    return df


# ── Inference helpers ─────────────────────────────────────────────────────────

def _get_latest_features(
    master_df : pd.DataFrame,
    X_full    : pd.DataFrame,
    meta_full : pd.DataFrame,
):
    """Extract feature rows for the most recent inspection per asset.

    meta_full only covers training rows (has_target==True), so assets
    with a single inspection are absent. We handle that by working
    from master_df directly for the latest-row lookup, then align
    against X_full by positional index.
    """
    feat_cols = list(X_full.columns)

    # Rebuild a combined frame that covers ALL rows (not just training
    # rows) so single-inspection assets are included in inference.
    all_df = master_df.copy()
    all_df = all_df.sort_values(['asset_id', 'inspection_date']).reset_index(drop=True)

    from app.services.analytics.feature_engineering import (
        _add_severity_features,
        _add_timing_features,
        _add_encoded_categoricals,
        _ensure_placeholder_columns,
    )

    all_df = _add_severity_features(all_df)
    all_df = _add_timing_features(all_df)
    all_df = _add_encoded_categoricals(all_df)
    all_df = _ensure_placeholder_columns(all_df)

    # Latest inspection row per asset
    latest_idx  = all_df.groupby('asset_id')['inspection_date'].idxmax()
    latest_rows = all_df.loc[latest_idx].reset_index(drop=True)

    X_lat = latest_rows[feat_cols].reset_index(drop=True)

    m_lat = latest_rows[['asset_id', 'inspection_date',
                          'max_severity_det', 'inspection_frequency_days']].copy()
    m_lat = m_lat.rename(columns={'max_severity_det': 'current_severity'})

    # asset_name from master_df
    asset_names = (
        master_df[['asset_id', 'asset_name']]
        .drop_duplicates('asset_id')
        .set_index('asset_id')['asset_name']
    )
    m_lat['asset_name'] = m_lat['asset_id'].map(asset_names)
    m_lat = m_lat.reset_index(drop=True)

    return X_lat, m_lat


def _forecast_note(pred: int, confidence: str,
                   horizon_days: int, current_severity: int) -> str:
    labels = {
        1: 'S1 (Minor)', 2: 'S2 (Moderate)',
        3: 'S3 (Significant)', 4: 'S4 (Critical)',
    }
    c = labels.get(current_severity, f'S{current_severity}')
    p = labels.get(pred, f'S{pred}')

    if pred > current_severity:
        direction = 'Worsening expected'
        suffix = ''
    elif pred < current_severity:
        direction = 'Improvement expected'
        suffix = ' No maintenance record found — verify before acting on this.'
    else:
        direction = 'Stable expected'
        suffix = ''

    return (
        f'{direction}: {c} -> {p} within {horizon_days} days. '
        f'Confidence: {confidence}.{suffix}'
    )


def _cap_low_severity_forecast(curr_sev: int, pred: int, conf: str) -> tuple[int, str]:
    """Cap spurious high-severity forecasts for low-severity assets.

    The LightGBM forecaster was trained on synthetic data in which S1/S2 never
    appeared as forecast targets, so it bias-predicts S4 for assets that are
    currently at S1 or S2. For such an asset, cap any prediction above the
    current severity at the current severity (a stable expectation is safer than
    a spurious critical alarm) and mark the confidence Medium to signal the
    override. Assets at S3/S4 are left untouched, as are predictions that are
    already at or below the current severity.
    """
    if curr_sev <= 2 and pred > curr_sev:
        return curr_sev, 'Medium'
    return pred, conf


# ── Public API ────────────────────────────────────────────────────────────────

def run_forecast_from_dataframe(
    input_df   : pd.DataFrame,
    model_path : str = None,
) -> pd.DataFrame:
    """
    Run severity forecasting from build_analytics_dataframe() output.

    Parameters
    ----------
    input_df : pd.DataFrame
        Columns: asset_id, asset_name, asset_type,
                 inspection_date, severity_score.
        Typically the output of build_analytics_dataframe().
    model_path : str, optional
        Path to serialised LGBMForecaster. Defaults to
        backend/ml_models/forecast_model.pkl.

    Returns
    -------
    pd.DataFrame with columns:
        asset_id, forecast_severity_next, forecast_confidence,
        forecast_horizon_days, forecast_note.
    Returns empty DataFrame when model file is missing or on error.
    """
    # Safety valve for test environments where LightGBM's native thread
    # scheduler conflicts with the test runner (e.g. macOS + pytest).
    # Set MIRA_DISABLE_FORECAST=1 to skip model inference entirely;
    # the pipeline still runs and forecast columns come back as None.
    if os.environ.get('MIRA_DISABLE_FORECAST') == '1':
        return pd.DataFrame()

    if model_path is None:
        model_path = _DEFAULT_MODEL_PATH

    if not os.path.exists(model_path):
        warnings.warn(
            f'[forecast] Model not found at {model_path}. '
            'Forecast columns omitted from pipeline output.',
            UserWarning, stacklevel=2,
        )
        return pd.DataFrame()

    if input_df is None or len(input_df) == 0:
        return pd.DataFrame()

    try:
        master_df = _build_master_df(input_df)

        # build_feature_matrix requires at least one training row
        # (an asset with two or more inspections).
        if master_df['has_target'].sum() == 0:
            warnings.warn(
                '[forecast] No assets have 2+ inspections — '
                'forecast skipped.',
                UserWarning, stacklevel=2,
            )
            return pd.DataFrame()

        # build_feature_matrix to confirm feature space matches the
        # trained model; we use _get_latest_features for inference rows.
        X_full, _, meta_full = build_feature_matrix(
            master_df, use_placeholders=True
        )
        if X_full.empty:
            return pd.DataFrame()

        X_lat, m_lat = _get_latest_features(master_df, X_full, meta_full)

        model = LGBMForecaster.load(model_path)

        # Reorder columns to match the feature order the model was
        # trained with. LightGBM is strict about column order and names.
        if model.feature_names_:
            X_lat = X_lat.reindex(columns=model.feature_names_, fill_value=np.nan)

        # LightGBM's C layer requires a float64 numpy array. Mixed-type
        # or object-dtype DataFrames can cause a segfault on predict.
        X_arr = X_lat.astype(float).to_numpy(dtype=np.float64, na_value=np.nan)

        preds, proba = model.predict(X_arr)
        confidences  = list(LGBMForecaster.proba_to_confidence(proba))

        # Assets with only one inspection have no lag signal —
        # downgrade any High confidence to Medium.
        for i in range(len(confidences)):
            lag1 = X_lat.iloc[i].get('severity_lag1', np.nan)
            if pd.isna(lag1) and confidences[i] == 'High':
                confidences[i] = 'Medium'

        rows = []
        for i in range(len(preds)):
            row          = m_lat.iloc[i]
            curr_sev     = int(row.get('current_severity') or 2)
            horizon_days = int(
                row.get('inspection_frequency_days') or _DEFAULT_HORIZON_DAYS
            )
            pred = int(preds[i])
            conf = confidences[i]

            # Cap spurious high-severity forecasts for S1/S2 assets (the model
            # bias-predicts S4 for low-severity assets — see helper docstring).
            pred, conf = _cap_low_severity_forecast(curr_sev, pred, conf)

            rows.append({
                'asset_id':               row['asset_id'],
                'forecast_severity_next': pred,
                'forecast_confidence':    conf,
                'forecast_horizon_days':  horizon_days,
                'forecast_note':          _forecast_note(
                                              pred, conf, horizon_days, curr_sev
                                          ),
            })

        return pd.DataFrame(rows) if rows else pd.DataFrame()

    except Exception as exc:  # noqa: BLE001
        warnings.warn(
            f'[forecast] Forecasting failed: {exc}. '
            'Forecast columns omitted from pipeline output.',
            UserWarning, stacklevel=2,
        )
        return pd.DataFrame()
