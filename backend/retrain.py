"""
retrain.py
----------
Standalone script to retrain the LGBMForecaster on updated CSV data.

Use when:
  - New inspection records have been exported to source CSVs
  - Switching from synthetic to real inspection data
  - Periodic recalibration on a refreshed dataset

The production inference pipeline (forecast.py -> engine.py) loads
the serialised model from ml_models/forecast_model.pkl. This script
updates that file; it does not run on every API call.

Usage (run from the backend/ directory):
    python retrain.py
    python retrain.py --data_dir /path/to/csvs --model_path ml_models/forecast_model.pkl

Required CSV files in data_dir:
    assets.csv, inspections.csv, detections.csv,
    images.csv, risk_assessments.csv, damage_progressions.csv
"""

import argparse
import json
import os
import sys

# Ensure app.* imports resolve when running as a top-level script.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.analytics.data_pipeline       import build_master_table
from app.services.analytics.feature_engineering import build_feature_matrix
from app.services.analytics.lightgbm_model      import LGBMForecaster


def parse_args():
    p = argparse.ArgumentParser(description='Retrain severity forecasting model')
    p.add_argument('--data_dir',    default='data/',
                   help='Directory containing the six source CSV files')
    p.add_argument('--model_path',  default='ml_models/forecast_model.pkl',
                   help='Output path for the serialised model')
    p.add_argument('--metrics_out', default='outputs/retrain_metrics.json',
                   help='Output path for validation metrics JSON')
    return p.parse_args()


def retrain(
    data_dir:    str = 'data/',
    model_path:  str = 'ml_models/forecast_model.pkl',
    metrics_out: str = 'outputs/retrain_metrics.json',
) -> LGBMForecaster:
    print('\n' + '=' * 58)
    print('  RETRAIN — Severity Forecasting Model')
    print('=' * 58)

    print('\n[retrain] Building master training table...')
    master_df = build_master_table(data_dir=data_dir)

    print('[retrain] Building feature matrix...')
    X, y, meta = build_feature_matrix(master_df, use_placeholders=True)

    print('[retrain] Training model...')
    model = LGBMForecaster()
    model.fit(X, y, meta)
    model.print_report()

    model.save(model_path)

    os.makedirs(os.path.dirname(os.path.abspath(metrics_out)), exist_ok=True)
    metrics = {
        'train': model.train_metrics_,
        'test':  model.test_metrics_,
        'feature_importance_top10': model.feature_importance_.head(10).to_dict(),
    }
    with open(metrics_out, 'w') as f:
        json.dump(metrics, f, indent=2)
    print(f'[retrain] Metrics saved to {metrics_out}')

    print('\n' + '=' * 58)
    print(f'  Retrain complete.')
    print(f'  Model  : {model_path}')
    print(f'  Metrics: {metrics_out}')
    print('=' * 58 + '\n')

    return model


if __name__ == '__main__':
    args = parse_args()
    retrain(
        data_dir=args.data_dir,
        model_path=args.model_path,
        metrics_out=args.metrics_out,
    )
