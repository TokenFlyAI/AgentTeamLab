"""
NFP Nowcasting Model Training

Trains XGBoost models to predict NFP outcomes for Kalshi markets.
"""

import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.model_selection import train_test_split, TimeSeriesSplit
from sklearn.metrics import brier_score_loss, log_loss, accuracy_score, classification_report
import json
import pickle
from pathlib import Path
from typing import Dict, List, Tuple
import yaml

from features import NFPFeatureEngineer, load_mock_data


def load_config() -> Dict:
    """Load model configuration"""
    config_path = Path(__file__).parent / 'config.yaml'
    with open(config_path, 'r') as f:
        return yaml.safe_load(f)


def train_threshold_model(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_test: pd.DataFrame,
    y_test: pd.Series,
    threshold: int,
    params: Dict
) -> Tuple[xgb.XGBClassifier, Dict]:
    """
    Train a single XGBoost model for one threshold.
    
    Returns:
        (model, metrics)
    """
    print(f"\nTraining model for threshold: {threshold}")
    print(f"  Train samples: {len(X_train)}, Positive rate: {y_train.mean():.2%}")
    print(f"  Test samples: {len(X_test)}, Positive rate: {y_test.mean():.2%}")
    
    # Handle class imbalance
    scale_pos_weight = (1 - y_train.mean()) / y_train.mean() if y_train.mean() > 0 else 1
    
    model_params = params.copy()
    model_params['scale_pos_weight'] = scale_pos_weight
    model = xgb.XGBClassifier(**model_params)
    
    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False
    )
    
    # Predictions
    y_pred_proba = model.predict_proba(X_test)[:, 1]
    y_pred = (y_pred_proba > 0.5).astype(int)
    
    # Metrics
    metrics = {
        'threshold': threshold,
        'brier_score': brier_score_loss(y_test, y_pred_proba),
        'log_loss': log_loss(y_test, y_pred_proba),
        'accuracy': accuracy_score(y_test, y_pred),
        'positive_rate_train': y_train.mean(),
        'positive_rate_test': y_test.mean(),
        'mean_prediction': y_pred_proba.mean(),
        'n_features': X_train.shape[1]
    }
    
    print(f"  Brier Score: {metrics['brier_score']:.4f}")
    print(f"  Accuracy: {metrics['accuracy']:.2%}")
    print(f"  Mean prediction: {metrics['mean_prediction']:.2%}")
    
    return model, metrics


def cross_validate_model(
    X: pd.DataFrame,
    y: pd.Series,
    threshold: int,
    params: Dict,
    n_splits: int = 5
) -> Dict:
    """
    Time-series cross-validation for a single threshold.
    """
    print(f"\nCross-validating threshold: {threshold}")
    
    tscv = TimeSeriesSplit(n_splits=n_splits)
    cv_scores = []
    
    for fold, (train_idx, test_idx) in enumerate(tscv.split(X)):
        X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
        y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]
        
        # Skip if not enough positive samples
        if y_train.sum() < 5 or y_test.sum() < 2:
            continue
            
        scale_pos_weight = (1 - y_train.mean()) / y_train.mean() if y_train.mean() > 0 else 1
        
        model_params = params.copy()
        model_params['scale_pos_weight'] = scale_pos_weight
        model = xgb.XGBClassifier(**model_params)
        
        model.fit(X_train, y_train, verbose=False)
        y_pred_proba = model.predict_proba(X_test)[:, 1]
        
        brier = brier_score_loss(y_test, y_pred_proba)
        cv_scores.append(brier)
        print(f"  Fold {fold+1}: Brier={brier:.4f}")
    
    return {
        'threshold': threshold,
        'cv_brier_mean': np.mean(cv_scores),
        'cv_brier_std': np.std(cv_scores),
        'n_folds': len(cv_scores)
    }


def train_all_models(
    features: pd.DataFrame,
    targets: pd.DataFrame,
    config: Dict,
    use_cv: bool = True
) -> Dict:
    """
    Train models for all thresholds.
    
    Returns:
        Dictionary of models and metrics
    """
    params = config['xgboost_params']
    thresholds = config['thresholds']
    
    # Time-based split (most recent 20% for test)
    split_idx = int(len(features) * 0.8)
    X_train = features.iloc[:split_idx]
    X_test = features.iloc[split_idx:]
    
    results = {
        'models': {},
        'metrics': {},
        'cv_results': {}
    }
    
    for threshold in thresholds:
        target_col = f'nfp_gt_{threshold}'
        if target_col not in targets.columns:
            continue
            
        y = targets[target_col]
        y_train = y.iloc[:split_idx]
        y_test = y.iloc[split_idx:]
        
        # Skip if not enough variation
        if y_train.nunique() < 2 or y_test.nunique() < 2:
            print(f"Skipping threshold {threshold} - insufficient class variation")
            continue
        
        # Cross-validation
        if use_cv:
            cv_results = cross_validate_model(features, y, threshold, params)
            results['cv_results'][threshold] = cv_results
        
        # Final model training
        model, metrics = train_threshold_model(
            X_train, y_train, X_test, y_test, threshold, params
        )
        
        results['models'][threshold] = model
        results['metrics'][threshold] = metrics
    
    return results


def save_models(results: Dict, config: Dict):
    """Save trained models and metrics"""
    output_dir = Path(__file__).parent / 'output'
    output_dir.mkdir(exist_ok=True)
    
    # Save models
    for threshold, model in results['models'].items():
        model_path = output_dir / f'model_threshold_{threshold}.pkl'
        with open(model_path, 'wb') as f:
            pickle.dump(model, f)
    
    # Save metrics
    metrics_path = output_dir / 'metrics.json'
    with open(metrics_path, 'w') as f:
        json.dump(results['metrics'], f, indent=2, default=str)
    
    # Save CV results
    if results['cv_results']:
        cv_path = output_dir / 'cv_results.json'
        with open(cv_path, 'w') as f:
            json.dump(results['cv_results'], f, indent=2, default=str)
    
    print(f"\nModels saved to: {output_dir}")


def print_summary(results: Dict):
    """Print training summary"""
    print("\n" + "="*60)
    print("TRAINING SUMMARY")
    print("="*60)
    
    print("\nThreshold Performance:")
    print("-" * 60)
    print(f"{'Threshold':>12} {'Brier':>10} {'Accuracy':>10} {'Pos Rate':>10}")
    print("-" * 60)
    
    for threshold, metrics in sorted(results['metrics'].items()):
        print(f"{threshold:>12,} {metrics['brier_score']:>10.4f} "
              f"{metrics['accuracy']:>9.2%} {metrics['positive_rate_test']:>9.2%}")
    
    if results['cv_results']:
        print("\nCross-Validation Brier Scores:")
        print("-" * 60)
        print(f"{'Threshold':>12} {'CV Mean':>10} {'CV Std':>10}")
        print("-" * 60)
        for threshold, cv in sorted(results['cv_results'].items()):
            print(f"{threshold:>12,} {cv['cv_brier_mean']:>10.4f} {cv['cv_brier_std']:>10.4f}")


def main():
    """Main training pipeline"""
    print("NFP Nowcasting Model Training")
    print("="*60)
    
    # Load config
    config = load_config()
    print(f"\nModel: {config['model']['name']}")
    print(f"Version: {config['model']['version']}")
    
    # Load data (mock for now, replace with Grace's pipeline)
    print("\nLoading data...")
    data = load_mock_data()
    
    # Engineer features
    print("Engineering features...")
    engineer = NFPFeatureEngineer()
    features, targets = engineer.build_feature_matrix(
        nfp_df=data['nfp'],
        adp_df=data['adp'],
        claims_df=data['claims'],
        ism_df=data['ism'],
        postings_df=data['postings'],
        thresholds=config['thresholds']
    )
    
    print(f"Feature matrix: {features.shape}")
    print(f"Targets: {targets.shape}")
    print(f"Features: {engineer.feature_names}")
    
    # Train models
    print("\nTraining models...")
    results = train_all_models(features, targets, config, use_cv=True)
    
    # Print summary
    print_summary(results)
    
    # Save models
    save_models(results, config)
    
    print("\nTraining complete!")


if __name__ == '__main__':
    main()
