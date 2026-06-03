"""
forecasting/lightgbm_model.py
------------------------------
LightGBM severity forecasting model with walk-forward time-series
cross-validation.

Primary model: LightGBM classifier (lgb.LGBMClassifier)
Fallback:      sklearn GradientBoostingClassifier
               (used when lightgbm is not installed)

Walk-forward split:
  All training rows sorted chronologically.
  First 70% -> train, last 30% -> test.
  This mirrors production: model always predicts on data it has
  never seen, trained only on past inspections.

Class imbalance handling:
  Target is 80% S4, 20% S3. LightGBM uses is_unbalance=True.
  sklearn fallback uses class_weight='balanced'.

Usage:
    from forecasting.lightgbm_model import LGBMForecaster
    model = LGBMForecaster()
    model.fit(X, y, meta)
    preds, proba = model.predict(X_test)
    model.save('models/forecast_model.pkl')
"""

import os
import pickle
import warnings
import numpy as np
import pandas as pd

from sklearn.metrics import (
    accuracy_score, f1_score, mean_absolute_error, confusion_matrix
)

# LightGBM with sklearn fallback
try:
    import lightgbm as lgb
    _LGBM_AVAILABLE = True
except ImportError:
    from sklearn.ensemble import HistGradientBoostingClassifier  # noqa: F401
    _LGBM_AVAILABLE = False
    warnings.warn(
        'lightgbm not found — using sklearn HistGradientBoostingClassifier as '
        'fallback (handles NaN natively). Install with: pip install lightgbm',
        ImportWarning, stacklevel=2
    )

# # Default hyperparameters
# LGBM_PARAMS = {
#     'n_estimators':      200,
#     'learning_rate':     0.05,
#     'max_depth':         5,
#     'num_leaves':        20,
#     'min_child_samples': 5,
#     'subsample':         0.8,
#     'colsample_bytree':  0.8,
#     'reg_alpha':         0.1,
#     'reg_lambda':        0.1,
#     'is_unbalance':      True,
#     'verbose':           -1,
#     'random_state':      42,
# }

# Modified hyperparameters
LGBM_PARAMS = {
    'n_estimators':      200,
    'learning_rate':     0.05,
    'max_depth':         5,
    'num_leaves':        20,
    'min_child_samples': 5,
    'subsample':         0.8,
    'colsample_bytree':  0.8,
    'reg_alpha':         0.1,
    'reg_lambda':        0.1,
    'class_weight':      {3: 6, 4: 1},   # explicit: S3 weighted 6x vs S4
    'verbose':           -1,
    'random_state':      42,
}

SKLEARN_FALLBACK_PARAMS = {
    'n_estimators':  200,
    'learning_rate': 0.05,
    'max_depth':     5,
    'subsample':     0.8,
    'random_state':  42,
}

TRAIN_RATIO = 0.70


class LGBMForecaster:
    """
    LightGBM severity forecasting model.
    Trains on first TRAIN_RATIO of chronologically sorted data.
    Evaluates on remaining held-out period.
    """

    def __init__(self, params: dict = None):
        self.params_             = params or (LGBM_PARAMS if _LGBM_AVAILABLE
                                              else SKLEARN_FALLBACK_PARAMS)
        self.model_              = None
        self.classes_            = None
        self.feature_names_      = None
        self.is_fitted_          = False
        self.train_metrics_      = None
        self.test_metrics_       = None
        self.feature_importance_ = None
        self.backend_            = 'lightgbm' if _LGBM_AVAILABLE else 'sklearn_fallback'

    # Walk-forward split
    @staticmethod
    def walk_forward_split(X, y, meta, train_ratio=TRAIN_RATIO):
        """
        Chronological train/test split by inspection_date.
        Returns X_train, X_test, y_train, y_test, meta_train, meta_test.
        """
        idx   = meta['inspection_date'].argsort().values
        split = int(len(idx) * train_ratio)
        tr, te = idx[:split], idx[split:]

        return (
            X.iloc[tr].reset_index(drop=True),
            X.iloc[te].reset_index(drop=True),
            y.iloc[tr].reset_index(drop=True),
            y.iloc[te].reset_index(drop=True),
            meta.iloc[tr].reset_index(drop=True),
            meta.iloc[te].reset_index(drop=True),
        )

    def fit(self, X, y, meta):
        """
        Fit the model using walk-forward train/test split.
        Stores train and test metrics for validation report.
        """
        self.feature_names_ = list(X.columns)
        self.classes_       = sorted(y.unique())

        X_train, X_test, y_train, y_test, _, _ = self.walk_forward_split(X, y, meta)

        print(f'[lgbm] Backend   : {self.backend_}')
        print(f'[lgbm] Train rows: {len(X_train)} | Test rows: {len(X_test)}')
        print(f'[lgbm] Train dist: {dict(y_train.value_counts().sort_index())}')
        print(f'[lgbm] Test dist : {dict(y_test.value_counts().sort_index())}')

        if _LGBM_AVAILABLE:
            self.model_ = lgb.LGBMClassifier(**self.params_)
            self.model_.fit(X_train, y_train, feature_name=self.feature_names_)
            importances = self.model_.feature_importances_
        else:
            from sklearn.ensemble import HistGradientBoostingClassifier
            self.model_ = HistGradientBoostingClassifier(
                max_iter=200, learning_rate=0.05, max_depth=5,
                class_weight="balanced", random_state=42
            )
            self.model_.fit(X_train, y_train)
            importances = np.ones(len(self.feature_names_))

        self.feature_importance_ = pd.Series(
            importances, index=self.feature_names_
        ).sort_values(ascending=False)

        # Evaluate
        test_preds  = self.model_.predict(X_test)
        test_proba  = self.model_.predict_proba(X_test)
        self.test_metrics_  = self._compute_metrics(y_test,  test_preds,  test_proba,  'test')

        train_preds = self.model_.predict(X_train)
        train_proba = self.model_.predict_proba(X_train)
        self.train_metrics_ = self._compute_metrics(y_train, train_preds, train_proba, 'train')

        self.is_fitted_ = True
        print(f'[lgbm] Test exact accuracy: {self.test_metrics_["exact_accuracy"]:.1%}')
        print(f'[lgbm] Test weighted F1   : {self.test_metrics_["weighted_f1"]:.4f}')
        return self

    def predict(self, X):
        """
        Run inference. Returns (predictions array, probabilities array).
        predictions: integer severity 1-4
        probabilities: shape (n, n_classes)
        """
        if not self.is_fitted_:
            raise RuntimeError('Call fit() before predict().')
        return self.model_.predict(X).astype(int), self.model_.predict_proba(X)

    @staticmethod
    def proba_to_confidence(proba):
        """
        Map max class probability to confidence label.
        High >= 0.70, Medium >= 0.50, Low < 0.50
        """
        out = []
        for row in proba:
            mp = row.max()
            out.append('High' if mp >= 0.70 else 'Medium' if mp >= 0.50 else 'Low')
        return out

    def _compute_metrics(self, y_true, y_pred, proba, split=''):
        y_t = np.array(y_true)
        y_p = np.array(y_pred)

        per_class = {}
        for cls in [3, 4]:
            mask = y_t == cls
            if mask.sum() > 0:
                per_class[f'S{cls}_accuracy'] = round(
                    float(accuracy_score(y_t[mask], y_p[mask])), 4
                )

        return {
            'split':              split,
            'model':              f'LGBMForecaster ({self.backend_})',
            'exact_accuracy':     round(float(accuracy_score(y_t, y_p)), 4),
            'ordinal_accuracy':   round(float(np.mean(np.abs(y_t - y_p) <= 1)), 4),
            'directional_acc':    round(float(np.mean(
                                      np.sign(y_t - 2.5) == np.sign(y_p - 2.5))), 4),
            'mae':                round(float(mean_absolute_error(y_t, y_p)), 4),
            'weighted_f1':        round(float(f1_score(y_t, y_p,
                                          average='weighted', zero_division=0)), 4),
            'per_class_accuracy': per_class,
            'confusion_matrix':   confusion_matrix(
                                      y_t, y_p, labels=[1, 2, 3, 4]).tolist(),
            'n_samples':          int(len(y_t)),
        }

    def evaluate(self, y_true, y_pred, proba):
        return self._compute_metrics(y_true, y_pred, proba, split='eval')

    def save(self, path):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, 'wb') as f:
            pickle.dump(self, f)
        print(f'[lgbm] Model saved to {path}')

    @classmethod
    def load(cls, path):
        # The pkl may have been serialised from the standalone repo
        # where the module path was 'forecasting.lightgbm_model'.
        # Remap it to the backend path so it unpickles without error.
        class _RemappingUnpickler(pickle.Unpickler):
            _MODULE_MAP = {
                'forecasting.lightgbm_model': (
                    'app.services.analytics.lightgbm_model'
                ),
            }

            def find_class(self, module, name):
                module = self._MODULE_MAP.get(module, module)
                return super().find_class(module, name)

        with open(path, 'rb') as f:
            obj = _RemappingUnpickler(f).load()
        if not isinstance(obj, cls):
            raise TypeError(f'Expected LGBMForecaster, got {type(obj)}')
        return obj

    def print_report(self):
        if not self.is_fitted_:
            raise RuntimeError('Model not fitted.')
        for metrics in [self.train_metrics_, self.test_metrics_]:
            s = metrics['split'].upper()
            print('=' * 58)
            print(f"  {metrics['model']}  [{s}]")
            print('=' * 58)
            print(f"  Samples           : {metrics['n_samples']}")
            print(f"  Exact accuracy    : {metrics['exact_accuracy']:.1%}")
            print(f"  Ordinal acc (±1)  : {metrics['ordinal_accuracy']:.1%}")
            print(f"  Directional acc   : {metrics['directional_acc']:.1%}")
            print(f"  MAE               : {metrics['mae']:.4f}")
            print(f"  Weighted F1       : {metrics['weighted_f1']:.4f}")
            for k, v in metrics.get('per_class_accuracy', {}).items():
                print(f'  {k:<18}: {v:.1%}')
            print()
            print('  Confusion matrix (rows=actual, cols=predicted):')
            print('  Labels: [S1, S2, S3, S4]')
            for row in metrics['confusion_matrix']:
                print(f'    {row}')
            print()
        print('  Top 10 Feature Importances:')
        print('  ' + '-' * 40)
        for feat, imp in self.feature_importance_.head(10).items():
            print(f'  {feat:<35} {imp:.0f}')
        print('=' * 58)
