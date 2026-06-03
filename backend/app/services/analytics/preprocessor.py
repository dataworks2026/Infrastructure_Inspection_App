
# Cleans and prepares validated input data for analytics.
# Responsibilities:
#   - Maps severity S1-S4 to numeric 1-4
#   - Parses and sorts inspection dates chronologically
#   - Aggregates to max severity per asset per inspection
#   - Outputs one clean timeline per asset


import pandas as pd


# Severity mapping — S1/S2/S3/S4 → 1/2/3/4
SEVERITY_MAP = {
    'S1': 1, 'S2': 2, 'S3': 3, 'S4': 4,
    1: 1,    2: 2,    3: 3,    4: 4
}


def preprocess(df: pd.DataFrame) -> pd.DataFrame:
    """
    Cleans and prepares raw inspection data for analytics modules.

    Parameters:
        df (pd.DataFrame): Validated dataframe from data_loader.

    Returns:
        pd.DataFrame: Clean, sorted dataframe with one row per
                      asset per inspection date, using max severity.
    """

    df = df.copy()

    # Step 1: Map severity to numeric
    df['severity_score'] = df['severity_score'].map(SEVERITY_MAP)

    unmapped = df['severity_score'].isnull().sum()
    if unmapped > 0:
        raise ValueError(
            f"[preprocessor] {unmapped} severity values could not be mapped. "
            f"Check input data for unexpected values."
        )

    print("[preprocessor] Severity values mapped to numeric scale (1-4).")

    #  Step 2: Parse inspection dates
    df['inspection_date'] = pd.to_datetime(df['inspection_date'])
    print("[preprocessor] Inspection dates parsed successfully.")

    # Step 3: Aggregate max severity per asset per date
    # One inspection can have multiple detections at different
    # severity levels. We take the maximum as confirmed by client.
    agg_cols = ['asset_id', 'inspection_date']

    # Carry forward asset_name and asset_type alongside aggregation
    meta = df.groupby('asset_id').agg(
        asset_name=('asset_name', 'first'),
        asset_type=('asset_type', 'first'),
        component_type=('component_type', 'first'),
        damage_type=('damage_type', 'first')
    ).reset_index()

    severity_agg = df.groupby(agg_cols)['severity_score'].max().reset_index()

    # Merge meta back in
    df_clean = severity_agg.merge(meta, on='asset_id', how='left')

    print(
        f"[preprocessor] Aggregated to max severity per inspection. "
        f"{len(df_clean)} inspection records across "
        f"{df_clean['asset_id'].nunique()} assets."
    )

    # Step 4: Sort chronologically per asset
    df_clean = df_clean.sort_values(
        ['asset_id', 'inspection_date']
    ).reset_index(drop=True)

    print("[preprocessor] Data sorted chronologically per asset.")

    # Step 5: Add inspection sequence number per asset
    # Useful for deterioration rate calculations downstream
    df_clean['inspection_seq'] = df_clean.groupby('asset_id').cumcount() + 1

    # Step 6: Final column ordering
    df_clean = df_clean[[
        'asset_id', 'asset_name', 'asset_type',
        'component_type', 'damage_type',
        'inspection_date', 'inspection_seq', 'severity_score'
    ]]

    print("[preprocessor] Preprocessing complete.\n")
    _print_summary(df_clean)

    return df_clean


def _print_summary(df: pd.DataFrame):
    """
    Prints a clean summary of preprocessed data per asset.
    Useful for quick sanity check before analytics run.
    """
    print("[preprocessor] Asset Summary:")
    print("-" * 65)
    summary = df.groupby(['asset_id', 'asset_name', 'asset_type']).agg(
        inspections=('inspection_date', 'count'),
        first_inspection=('inspection_date', 'min'),
        last_inspection=('inspection_date', 'max'),
        min_severity=('severity_score', 'min'),
        max_severity=('severity_score', 'max'),
    ).reset_index()

    for _, row in summary.iterrows():
        print(
            f"  {row['asset_id']} | {row['asset_name']} ({row['asset_type']}) | "
            f"{row['inspections']} inspections | "
            f"severity range: {row['min_severity']}-{row['max_severity']} | "
            f"{row['first_inspection'].date()} → {row['last_inspection'].date()}"
        )
    print("-" * 65)
