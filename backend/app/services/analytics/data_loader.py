
# Loads and validates the input CSV file.
# Ensures required columns exist, types are correct,
# and no critical values are missing before processing begins.

import pandas as pd


REQUIRED_COLUMNS = ['asset_id', 'inspection_date', 'severity_score']
OPTIONAL_COLUMNS = ['asset_name', 'asset_type', 'component_type', 'damage_type']
VALID_SEVERITY_VALUES = {1, 2, 3, 4, 'S1', 'S2', 'S3', 'S4'}


def load_data(filepath: str) -> pd.DataFrame:
    """
    Loads inspection data from a CSV file and validates it.

    Parameters:
        filepath (str): Path to the input CSV file.

    Returns:
        pd.DataFrame: Validated dataframe ready for preprocessing.

    Raises:
        FileNotFoundError: If the file path does not exist.
        ValueError: If required columns are missing or data is invalid.
    """

    # Step 1: Load the file
    try:
        df = pd.read_csv(filepath)
    except FileNotFoundError:
        raise FileNotFoundError(f"Input file not found: {filepath}")

    print(f"[data_loader] Loaded {len(df)} rows from '{filepath}'")

    # Step 2: Check required columns exist
    missing_cols = [col for col in REQUIRED_COLUMNS if col not in df.columns]
    if missing_cols:
        raise ValueError(
            f"[data_loader] Missing required columns: {missing_cols}\n"
            f"Required columns are: {REQUIRED_COLUMNS}"
        )

    # Step 3: Check for nulls in required columns
    for col in REQUIRED_COLUMNS:
        null_count = df[col].isnull().sum()
        if null_count > 0:
            raise ValueError(
                f"[data_loader] Column '{col}' has {null_count} missing values. "
                f"All required columns must be complete."
            )

    # Step 4: Validate severity values
    invalid_severity = df[~df['severity_score'].isin(VALID_SEVERITY_VALUES)]
    if len(invalid_severity) > 0:
        raise ValueError(
            f"[data_loader] Found {len(invalid_severity)} invalid severity values.\n"
            f"Valid values are 1-4 or S1-S4.\n"
            f"Invalid rows:\n{invalid_severity[['asset_id', 'inspection_date', 'severity_score']]}"
        )

    # Step 5: Validate inspection_date is parseable
    try:
        pd.to_datetime(df['inspection_date'])
    except Exception:
        raise ValueError(
            "[data_loader] Column 'inspection_date' contains unparseable date values. "
            "Expected format: YYYY-MM-DD"
        )

    # Step 6: Add optional columns with defaults
    # asset_type defaults to 'default' so thresholds.yaml fallback applies
    if 'asset_type' not in df.columns:
        df['asset_type'] = 'default'
        print("[data_loader] 'asset_type' column not found — using 'default' for all assets.")

    if 'asset_name' not in df.columns:
        df['asset_name'] = df['asset_id']
        print("[data_loader] 'asset_name' column not found — using asset_id as name.")

    if 'component_type' not in df.columns:
        df['component_type'] = None

    if 'damage_type' not in df.columns:
        df['damage_type'] = None

    print(f"[data_loader] Validation passed. {df['asset_id'].nunique()} unique assets found.")
    return df
