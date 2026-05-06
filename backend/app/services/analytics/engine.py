# Master orchestrator — the single entry point for the
# Infrastructure Asset Analytics Module.

# Usage:
#   from src.engine import run_pipeline
#   output_df = run_pipeline('data/sample_input.csv')

# Or from terminal:
#   python run.py --input data/sample_input.csv

# Runs the full pipeline:
#   load → preprocess → deterioration → anomaly → priority → TTI
# Returns a single clean output dataframe.


import os
import yaml
import pandas as pd
from app.services.analytics.data_loader   import load_data
from app.services.analytics.preprocessor  import preprocess
from app.services.analytics.deterioration import calculate_deterioration
from app.services.analytics.anomaly       import detect_anomalies
from app.services.analytics.priority      import calculate_priority
from app.services.analytics.tti           import calculate_tti


# Path to the thresholds.yaml that ships alongside this module.
# Built from __file__ so it resolves correctly no matter which
# working directory the caller runs from (API handler, CLI, tests).
DEFAULT_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "config",
    "thresholds.yaml",
)


# Canonical column order for the V2 output DataFrame produced by
# every public entry point in this module. Defined here so the
# empty-input early-return and the normal output path cannot drift
# out of sync.
V2_OUTPUT_COLUMNS = [
    "priority_rank",
    "asset_id",
    "asset_name",
    "asset_type",
    "latest_severity",
    "trend_direction",
    "severity_change_rate",
    "acceleration",
    "has_anomaly",
    "anomaly_reason",
    "priority_score",
    "priority_label",
    "tti_days",
    "tti_label",
    "tti_note",
]


def run_pipeline(
    input_filepath  : str,
    config_filepath : str = 'config/thresholds.yaml',
    output_filepath : str = None
) -> pd.DataFrame:
    """
    Runs the full analytics pipeline end to end.

    This is the single callable entry point for backend integration.

    Parameters:
        input_filepath  (str): Path to input CSV file.
                               Required columns: asset_id,
                               inspection_date, severity_score.
                               Optional: asset_name, asset_type,
                               component_type, damage_type.
        config_filepath (str): Path to thresholds.yaml config.
                               Defaults to 'config/thresholds.yaml'.
        output_filepath (str): Optional path to save output CSV.

    Returns:
        pd.DataFrame: Final output with all analytics results per asset.
    """

    print("=" * 65)
    print("  Infrastructure Asset Analytics Module")
    print("=" * 65)

    # ── Step 1: Load config ────────────────────────────────
    config = _load_config(config_filepath)

    # ── Step 2: Load and validate data ────────────────────
    raw_df = load_data(input_filepath)

    # ── Step 3: Preprocess ────────────────────────────────
    clean_df = preprocess(raw_df)

    # ── Step 4: Deterioration analysis ────────────────────
    deterioration_df = calculate_deterioration(clean_df)

    # ── Step 5: Anomaly detection ─────────────────────────
    anomaly_df = detect_anomalies(clean_df, config)

    # ── Step 6: Priority scoring ──────────────────────────
    priority_df = calculate_priority(
        deterioration_df, anomaly_df, clean_df, config
    )

    # ── Step 7: TTI calculation ────────────────────────────
    tti_df = calculate_tti(deterioration_df, config)

    # ── Step 8: Build final output ────────────────────────
    output_df = _build_output(priority_df, anomaly_df, tti_df)

    # ── Step 9: Save output if path provided ──────────────
    if output_filepath:
        os.makedirs(os.path.dirname(output_filepath), exist_ok=True)
        output_df.to_csv(output_filepath, index=False)
        print(f"\n[engine] Output saved to '{output_filepath}'")

    # ── Step 10: Print final summary ──────────────────────
    _print_final_summary(output_df)

    print("=" * 65)
    print("  Pipeline complete.")
    print("=" * 65)

    return output_df


def run_pipeline_from_dataframe(
    df              : pd.DataFrame,
    config_filepath : str = None,
) -> pd.DataFrame:
    """
    Run the analytics pipeline starting from an already-assembled DataFrame.

    This is the entry point used by the FastAPI backend once the
    data_adapter has built the input frame directly from the database.
    The CSV-loading step (load_data) is skipped; everything from
    preprocessing onward runs exactly like run_pipeline.

    Parameters
    ----------
    df : pd.DataFrame
        Inspection history with the columns the CSV loader would
        produce: asset_id, asset_name, asset_type, inspection_date,
        severity_score (S1..S4 strings or 1..4 ints).
    config_filepath : str, optional
        Path to thresholds.yaml. Falls back to the config that ships
        alongside this module when not supplied.

    Returns
    -------
    pd.DataFrame
        V2 output schema: priority_rank, asset_id, asset_name,
        asset_type, latest_severity, trend_direction,
        severity_change_rate, acceleration, has_anomaly,
        anomaly_reason, priority_score, priority_label,
        tti_days, tti_label, tti_note.
    """

    if config_filepath is None:
        config_filepath = DEFAULT_CONFIG_PATH

    # ── Step 0: Short-circuit on empty input ──────────────
    # Orgs with no analysed inspections (new account, nothing to
    # process yet) must not crash the pipeline. Return the V2 schema
    # with zero rows so downstream callers can iterate or serialise
    # without checks of their own.
    if df is None or len(df) == 0:
        print("[engine] Input DataFrame is empty — returning empty V2 output.")
        return pd.DataFrame(columns=V2_OUTPUT_COLUMNS)

    # ── Step 1: Load config ────────────────────────────────
    config = _load_config(config_filepath)

    # Step 2 (load_data / validate CSV) is intentionally skipped —
    # the caller has already supplied a DataFrame of the correct shape.
    # load_data normally defaults a few optional columns when they
    # are absent; mirror that here so preprocess does not KeyError
    # on a clean DataFrame coming from data_adapter.
    df = df.copy()
    for _optional in ("asset_name", "asset_type", "component_type", "damage_type"):
        if _optional not in df.columns:
            df[_optional] = None

    # ── Step 3: Preprocess ────────────────────────────────
    clean_df = preprocess(df)

    # ── Step 4: Deterioration analysis ────────────────────
    deterioration_df = calculate_deterioration(clean_df)

    # ── Step 5: Anomaly detection ─────────────────────────
    anomaly_df = detect_anomalies(clean_df, config)

    # ── Step 6: Priority scoring ──────────────────────────
    priority_df = calculate_priority(
        deterioration_df, anomaly_df, clean_df, config
    )

    # ── Step 7: TTI calculation ───────────────────────────
    tti_df = calculate_tti(deterioration_df, config)

    # ── Step 8: Build final output ────────────────────────
    output_df = _build_output(priority_df, anomaly_df, tti_df)

    return output_df


def _load_config(config_filepath: str) -> dict:
    """Loads thresholds.yaml config file."""
    if not os.path.exists(config_filepath):
        raise FileNotFoundError(
            f"[engine] Config file not found: {config_filepath}"
        )
    with open(config_filepath, 'r') as f:
        config = yaml.safe_load(f)
    print(f"[engine] Config loaded from '{config_filepath}'")
    return config


def load_config(config_filepath: str = None) -> dict:
    """Public wrapper around _load_config so callers outside this
    module (e.g. the predictive router that needs weights for reason
    rows) do not need to import a private name or hard-code the path.

    Defaults to the thresholds.yaml that ships alongside this module.
    """
    return _load_config(config_filepath or DEFAULT_CONFIG_PATH)


def _build_output(
    priority_df : pd.DataFrame,
    anomaly_df  : pd.DataFrame,
    tti_df      : pd.DataFrame
) -> pd.DataFrame:
    """
    Builds the final clean output dataframe.
    Merges priority + anomaly reason + TTI results.
    """

    # Latest anomaly reason per asset
    latest_anomaly = anomaly_df[anomaly_df['anomaly_flag'] == True].copy()

    if len(latest_anomaly) > 0:
        latest_anomaly = (
            latest_anomaly
            .sort_values('inspection_date')
            .groupby('asset_id')
            .last()[['anomaly_reason', 'inspection_date']]
            .rename(columns={'inspection_date': 'latest_anomaly_date'})
            .reset_index()
        )
        output = priority_df.merge(latest_anomaly, on='asset_id', how='left')
    else:
        output = priority_df.copy()
        output['anomaly_reason']      = None
        output['latest_anomaly_date'] = None

    # Merge TTI results
    tti_cols = tti_df[['asset_id', 'tti_days', 'tti_label', 'tti_note']]
    output   = output.merge(tti_cols, on='asset_id', how='left')

    # Final column order — V2 output schema (single source of truth)
    output = output[V2_OUTPUT_COLUMNS]

    return output


def _print_final_summary(df: pd.DataFrame):
    """Prints a clean readable summary of final results."""
    print("\n[engine] Final Priority Rankings:")
    print("-" * 75)
    for _, row in df.iterrows():
        anomaly_marker = " 🚩" if row['has_anomaly'] else ""
        tti_display = (
            f"{int(row['tti_days'])}d"
            if row['tti_days'] is not None
            and str(row['tti_days']) != 'nan'
            else 'N/A'
        )
        print(
            f"  #{row['priority_rank']} | {row['asset_name']} "
            f"({row['asset_type']}) | "
            f"Sev: {row['latest_severity']} | "
            f"Trend: {row['trend_direction']} | "
            f"Score: {row['priority_score']} | "
            f"{row['priority_label']} | "
            f"TTI: {tti_display} ({row['tti_label']})"
            f"{anomaly_marker}"
        )
    print("-" * 75)