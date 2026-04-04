"""
NFP Model Evaluation

Evaluates model performance and calibration for production readiness.
"""

import pandas as pd
import numpy as np
import json
import pickle
from pathlib import Path
from typing import Dict, List
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

from features import NFPFeatureEngineer, load_mock_data
from predict import NFPPredictor


def calculate_calibration(predictions: np.ndarray, targets: np.ndarray, n_bins: int = 10) -> Dict:
    """
    Calculate calibration curve.
    
    Returns:
        Dict with bin_centers, bin_accuracies, bin_counts
    """
    bin_boundaries = np.linspace(0, 1, n_bins + 1)
    bin_centers = (bin_boundaries[:-1] + bin_boundaries[1:]) / 2
    
    bin_accuracies = []
    bin_counts = []
    
    for i in range(n_bins):
        mask = (predictions >= bin_boundaries[i]) & (predictions < bin_boundaries[i + 1])
        if i == n_bins - 1:  # Include right edge for last bin
            mask = (predictions >= bin_boundaries[i]) & (predictions <= bin_boundaries[i + 1])
        
        if mask.sum() > 0:
            accuracy = targets[mask].mean()
            count = mask.sum()
        else:
            accuracy = 0
            count = 0
        
        bin_accuracies.append(accuracy)
        bin_counts.append(count)
    
    return {
        'bin_centers': bin_centers.tolist(),
        'bin_accuracies': bin_accuracies,
        'bin_counts': bin_counts
    }


def evaluate_threshold(
    model,
    features: pd.DataFrame,
    targets: pd.Series,
    threshold: int
) -> Dict:
    """
    Evaluate model performance for a single threshold.
    """
    predictions = model.predict_proba(features)[:, 1]
    pred_binary = (predictions > 0.5).astype(int)
    
    # Basic metrics
    from sklearn.metrics import brier_score_loss, log_loss, accuracy_score, roc_auc_score
    
    metrics = {
        'threshold': threshold,
        'n_samples': len(features),
        'positive_rate': targets.mean(),
        'mean_prediction': predictions.mean(),
        'brier_score': brier_score_loss(targets, predictions),
        'log_loss': log_loss(targets, predictions),
        'accuracy': accuracy_score(targets, pred_binary),
    }
    
    # ROC AUC (if both classes present)
    if targets.nunique() > 1:
        metrics['roc_auc'] = roc_auc_score(targets, predictions)
    else:
        metrics['roc_auc'] = None
    
    # Calibration
    calibration = calculate_calibration(predictions, targets.values)
    metrics['calibration'] = calibration
    
    # Strategy simulation (simple edge-based)
    # Simulate: bet when |edge| > threshold, size proportional to edge
    simulated_returns = []
    for pred, actual in zip(predictions, targets):
        # Assume market price is noisy around true probability
        # This is a simplified simulation
        market_price = pred + np.random.normal(0, 0.1)  # Add noise
        market_price = np.clip(market_price, 0.05, 0.95)
        
        edge = abs(pred - market_price)
        if edge > 0.05:  # 5 cent edge threshold
            # Win if prediction direction matches outcome
            pred_direction = pred > 0.5
            if pred_direction == actual:
                simulated_returns.append(edge)
            else:
                simulated_returns.append(-edge)
    
    if simulated_returns:
        metrics['simulated_sharpe'] = np.mean(simulated_returns) / (np.std(simulated_returns) + 1e-8)
        metrics['simulated_pnl'] = sum(simulated_returns)
    else:
        metrics['simulated_sharpe'] = 0
        metrics['simulated_pnl'] = 0
    
    return metrics


def plot_calibration_curves(all_metrics: Dict, output_dir: Path):
    """Plot calibration curves for all thresholds"""
    fig, axes = plt.subplots(2, 2, figsize=(12, 10))
    axes = axes.flatten()
    
    for idx, (threshold, metrics) in enumerate(sorted(all_metrics.items())):
        if idx >= 4:
            break
            
        ax = axes[idx]
        cal = metrics['calibration']
        
        # Plot calibration curve
        ax.plot([0, 1], [0, 1], 'k--', label='Perfect calibration')
        ax.plot(cal['bin_centers'], cal['bin_accuracies'], 'o-', label='Model')
        
        # Add histogram of predictions
        ax2 = ax.twinx()
        ax2.bar(cal['bin_centers'], cal['bin_counts'], alpha=0.3, width=0.08, color='gray')
        ax2.set_ylabel('Count')
        
        ax.set_xlabel('Predicted Probability')
        ax.set_ylabel('Actual Frequency')
        ax.set_title(f'Threshold {threshold:,}\nBrier: {metrics["brier_score"]:.3f}, Acc: {metrics["accuracy"]:.1%}')
        ax.legend()
        ax.grid(True, alpha=0.3)
    
    plt.tight_layout()
    plt.savefig(output_dir / 'calibration_curves.png', dpi=150)
    print(f"Saved calibration plot to {output_dir / 'calibration_curves.png'}")


def generate_report(all_metrics: Dict) -> str:
    """Generate text report"""
    lines = []
    lines.append("="*70)
    lines.append("NFP MODEL EVALUATION REPORT")
    lines.append("="*70)
    lines.append("")
    
    # Summary table
    lines.append("Threshold Performance Summary:")
    lines.append("-"*70)
    lines.append(f"{'Threshold':>12} {'Brier':>10} {'Acc':>8} {'AUC':>8} {'Sharpe':>8}")
    lines.append("-"*70)
    
    for threshold in sorted(all_metrics.keys()):
        m = all_metrics[threshold]
        auc = f"{m['roc_auc']:.3f}" if m['roc_auc'] else "N/A"
        lines.append(
            f"{threshold:>12,} {m['brier_score']:>10.4f} "
            f"{m['accuracy']:>7.1%} {auc:>8} {m['simulated_sharpe']:>8.2f}"
        )
    
    lines.append("-"*70)
    lines.append("")
    
    # Calibration assessment
    lines.append("Calibration Assessment:")
    lines.append("-"*70)
    for threshold in sorted(all_metrics.keys()):
        m = all_metrics[threshold]
        cal = m['calibration']
        
        # Calculate calibration error
        errors = [abs(a - c) for a, c in zip(cal['bin_accuracies'], cal['bin_centers']) if c > 0]
        avg_error = np.mean(errors) if errors else 0
        
        status = "✅ Well calibrated" if avg_error < 0.1 else "⚠️ Poor calibration"
        lines.append(f"  Threshold {threshold:,}: {status} (avg error: {avg_error:.3f})")
    
    lines.append("")
    lines.append("Production Readiness:")
    lines.append("-"*70)
    
    # Check criteria
    criteria = []
    avg_brier = np.mean([m['brier_score'] for m in all_metrics.values()])
    criteria.append(("Brier score < 0.25", avg_brier < 0.25, f"{avg_brier:.4f}"))
    
    avg_acc = np.mean([m['accuracy'] for m in all_metrics.values()])
    criteria.append(("Accuracy > 60%", avg_acc > 0.6, f"{avg_acc:.1%}"))
    
    for name, passed, value in criteria:
        status = "✅" if passed else "❌"
        lines.append(f"  {status} {name}: {value}")
    
    lines.append("")
    lines.append("="*70)
    
    return "\n".join(lines)


def main():
    """Run full evaluation"""
    print("NFP Model Evaluation")
    print("="*70)
    
    # Load data
    data = load_mock_data()
    engineer = NFPFeatureEngineer()
    features, targets = engineer.build_feature_matrix(
        nfp_df=data['nfp'],
        adp_df=data['adp'],
        claims_df=data['claims'],
        ism_df=data['ism'],
        postings_df=data['postings']
    )
    
    # Load models and evaluate
    output_dir = Path(__file__).parent / 'output'
    model_files = list(output_dir.glob('model_threshold_*.pkl'))
    
    all_metrics = {}
    
    for model_file in model_files:
        threshold = int(model_file.stem.split('_')[-1])
        
        with open(model_file, 'rb') as f:
            model = pickle.load(f)
        
        target_col = f'nfp_gt_{threshold}'
        if target_col not in targets.columns:
            continue
        
        print(f"\nEvaluating threshold {threshold:,}...")
        metrics = evaluate_threshold(model, features, targets[target_col], threshold)
        all_metrics[threshold] = metrics
        
        print(f"  Brier: {metrics['brier_score']:.4f}")
        print(f"  Accuracy: {metrics['accuracy']:.1%}")
        if metrics['roc_auc']:
            print(f"  ROC AUC: {metrics['roc_auc']:.3f}")
    
    # Save metrics
    metrics_path = output_dir / 'evaluation_metrics.json'
    with open(metrics_path, 'w') as f:
        json.dump(all_metrics, f, indent=2, default=str)
    print(f"\nSaved metrics to {metrics_path}")
    
    # Generate report
    report = generate_report(all_metrics)
    report_path = output_dir / 'evaluation_report.txt'
    with open(report_path, 'w') as f:
        f.write(report)
    print(f"Saved report to {report_path}")
    
    # Plot calibration
    try:
        plot_calibration_curves(all_metrics, output_dir)
    except Exception as e:
        print(f"Could not generate plots: {e}")
    
    # Print report
    print("\n" + report)


if __name__ == '__main__':
    main()
