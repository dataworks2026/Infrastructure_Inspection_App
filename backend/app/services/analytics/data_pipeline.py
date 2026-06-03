"""
forecasting/data_pipeline.py
----------------------------
Builds the master training table for severity forecasting.

Joins six source tables:
  assets, inspections, detections, images,
  risk_assessments, damage_progressions

Output: one row per (asset x inspection), chronologically ordered,
with target variable: severity at next inspection.

Usage:
    from forecasting.data_pipeline import build_master_table
    df = build_master_table(data_dir='data/')
    df.to_csv('data/clean_master_table.csv', index=False)
"""

import os
import pandas as pd
import numpy as np  # noqa: F401 — used by downstream callers that import this module


# ── Severity label mapping ────────────────────────────────────────────────────
SEV_MAP = {'S1': 1, 'S2': 2, 'S3': 3, 'S4': 4,
           '1': 1, '2': 2, '3': 3, '4': 4,
           1: 1, 2: 2, 3: 3, 4: 4}


def _load_tables(data_dir: str) -> dict:
    """Load all six source CSVs from data_dir."""
    required = ['assets', 'inspections', 'detections',
                'images', 'risk_assessments', 'damage_progressions']
    tables = {}
    for name in required:
        path = os.path.join(data_dir, f'{name}.csv')
        if not os.path.exists(path):
            raise FileNotFoundError(f'Required file not found: {path}')
        tables[name] = pd.read_csv(path)
    return tables


def _map_severity(series: pd.Series) -> pd.Series:
    """Map S1–S4 string labels to integers 1–4."""
    return series.map(SEV_MAP)


def _aggregate_detections(detections: pd.DataFrame,
                           images: pd.DataFrame) -> pd.DataFrame:
    """
    Aggregate detection-level records to inspection level.
    Joins detections → images to get inspection_id, then aggregates.

    Returns one row per inspection_id with:
      det_count, max_severity_det, mean_severity_det,
      unique_damage_types, avg_confidence, immediate_repairs
    """
    detections = detections.copy()
    detections['severity_num'] = _map_severity(detections['severity'])

    img_map = images[['id', 'inspection_id']].rename(columns={'id': 'image_id'})
    det = detections.merge(img_map, on='image_id', how='left')

    agg = det.groupby('inspection_id').agg(
        det_count=('id', 'count'),
        max_severity_det=('severity_num', 'max'),
        mean_severity_det=('severity_num', 'mean'),
        unique_damage_types=('damage_type', 'nunique'),
        avg_confidence=('confidence_score', 'mean'),
        immediate_repairs=('repair_urgency', lambda x: (x == 'immediate').sum()),
    ).reset_index()

    return agg


def _aggregate_risk(risk: pd.DataFrame) -> pd.DataFrame:
    """
    Aggregate risk assessment records to inspection level.
    These are treated as PLACEHOLDER / optional features.
    When real environmental and sensor data is unavailable,
    these fields will be NaN and the pipeline runs cleanly.

    Returns one row per inspection_run_id.
    """
    risk = risk.copy()
    risk['current_severity_num'] = _map_severity(risk['current_severity'])

    agg = risk.groupby('inspection_run_id').agg(
        risk_score_max=('risk_score', 'max'),
        risk_30_days=('risk_30_days', 'max'),
        risk_90_days=('risk_90_days', 'max'),
        # ── PLACEHOLDER fields: environmental / structural context ──────────
        # These are optional. When not available they remain NaN.
        # The feature pipeline handles them as optional inputs.
        ph_environmental_exposure=('environmental_exposure', 'mean'),
        ph_structural_loading=('structural_loading', 'mean'),
        ph_age_factor=('age_factor', 'mean'),
        ph_maintenance_history=('maintenance_history', 'mean'),
        # ────────────────────────────────────────────────────────────────────
        flagged_for_followup=('flagged_for_followup', 'max'),
        max_severity_risk=('current_severity_num', 'max'),
    ).reset_index()

    return agg


def _aggregate_damage_progressions(damage_prog: pd.DataFrame) -> pd.DataFrame:
    """
    Aggregate damage progression records to asset level.
    Captures the worst-case progression state per asset.
    """
    agg = damage_prog.groupby('asset_id').agg(
        dp_severity_change_rate_max=('severity_change_rate', 'max'),
        dp_acceleration_any=('acceleration_detected', 'max'),
        dp_area_growth_max=('affected_area_growth_rate_mm2_month', 'max'),
        dp_unique_damage_types=('damage_type', 'nunique'),
    ).reset_index()

    return agg


def _build_target(df: pd.DataFrame) -> pd.DataFrame:
    """
    Construct target variable: severity at next inspection.
    For each asset, shift max_severity_det forward by 1 within the group.
    The last inspection per asset has no target (NaN) — excluded from training.
    """
    df = df.sort_values(['asset_id', 'inspection_date']).reset_index(drop=True)
    df['target_severity_next'] = (
        df.groupby('asset_id')['max_severity_det'].shift(-1)
    )
    return df


def build_master_table(data_dir: str = 'data/') -> pd.DataFrame:
    """
    Full pipeline: load → join → clean → target construction.

    Parameters
    ----------
    data_dir : str
        Directory containing the six source CSV files.

    Returns
    -------
    pd.DataFrame
        Master training table. Rows with target_severity_next = NaN
        are the last inspection per asset (no future label available).
        These rows are retained in the table but excluded from model training.
    """
    print('[data_pipeline] Loading source tables...')
    tables = _load_tables(data_dir)

    assets        = tables['assets']
    inspections   = tables['inspections']
    detections    = tables['detections']
    images        = tables['images']
    risk          = tables['risk_assessments']
    damage_prog   = tables['damage_progressions']

    # ── Step 1: Inspections + Asset metadata ─────────────────────────────────
    print('[data_pipeline] Joining assets...')
    asset_cols = ['id', 'name', 'infrastructure_type', 'installation_date',
                  'risk_category', 'elevation_ft', 'inspection_frequency_days',
                  'latitude', 'longitude']
    df = inspections.merge(
        assets[asset_cols],
        left_on='asset_id',
        right_on='id',
        suffixes=('', '_asset')
    )

    # ── Step 2: Detection aggregates ─────────────────────────────────────────
    print('[data_pipeline] Aggregating detections...')
    det_agg = _aggregate_detections(detections, images)
    df = df.merge(det_agg, left_on='id', right_on='inspection_id', how='left')

    # ── Step 3: Risk assessment aggregates (includes placeholder fields) ──────
    print('[data_pipeline] Aggregating risk assessments...')
    risk_agg = _aggregate_risk(risk)
    df = df.merge(risk_agg, left_on='id', right_on='inspection_run_id', how='left')

    # ── Step 4: Damage progression aggregates ────────────────────────────────
    print('[data_pipeline] Aggregating damage progressions...')
    dp_agg = _aggregate_damage_progressions(damage_prog)
    df = df.merge(dp_agg, on='asset_id', how='left')

    # ── Step 5: Parse dates ───────────────────────────────────────────────────
    df['inspection_date']  = pd.to_datetime(df['inspection_date'])
    df['installation_date'] = pd.to_datetime(df['installation_date'])

    # ── Step 6: Construct target variable ────────────────────────────────────
    print('[data_pipeline] Building target variable...')
    df = _build_target(df)

    # ── Step 7: Add row metadata ──────────────────────────────────────────────
    df['has_target'] = df['target_severity_next'].notna()

    total   = len(df)
    with_t  = df['has_target'].sum()
    print(f'[data_pipeline] Done. Total rows: {total} | '
          f'With target: {with_t} | Without target (last per asset): {total - with_t}')

    return df


if __name__ == '__main__':
    import sys
    data_dir   = sys.argv[1] if len(sys.argv) > 1 else 'data/'
    output_path = sys.argv[2] if len(sys.argv) > 2 else 'data/clean_master_table.csv'

    df = build_master_table(data_dir=data_dir)
    df.to_csv(output_path, index=False)
    print(f'[data_pipeline] Master table saved to {output_path}')
