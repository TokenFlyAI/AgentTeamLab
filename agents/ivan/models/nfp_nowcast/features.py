"""
NFP Nowcasting Feature Engineering

Transforms raw economic data into model features.
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional
from dataclasses import dataclass


@dataclass
class FeatureConfig:
    """Feature configuration"""
    adp_enabled: bool = True
    claims_enabled: bool = True
    ism_enabled: bool = True
    job_postings_enabled: bool = True
    credit_card_enabled: bool = False  # P1


class NFPFeatureEngineer:
    """Engineer features for NFP nowcasting"""
    
    def __init__(self, config: FeatureConfig = None):
        self.config = config or FeatureConfig()
        self.feature_names = []
        
    def transform_adp(self, adp_df: pd.DataFrame) -> pd.DataFrame:
        """
        Transform ADP employment data.
        
        Features:
        - adp_level: Raw ADP employment change
        - adp_yoy: Year-over-year change
        - adp_surprise: Difference from consensus
        - adp_momentum: 3-month change in ADP
        """
        features = pd.DataFrame(index=adp_df.index)
        features['adp_level'] = adp_df['employment_change']
        
        # YoY change (approximate using 12-month lag)
        features['adp_yoy'] = adp_df['employment_change'] - adp_df['employment_change'].shift(12)
        
        # Surprise vs consensus (if available)
        if 'consensus' in adp_df.columns:
            features['adp_surprise'] = adp_df['employment_change'] - adp_df['consensus']
        else:
            features['adp_surprise'] = 0
            
        # Momentum (3-month change)
        features['adp_momentum'] = adp_df['employment_change'].diff(3)
        
        return features
    
    def transform_claims(self, claims_df: pd.DataFrame) -> pd.DataFrame:
        """
        Transform initial and continuing claims.
        
        Features:
        - claims_4wk_ma: 4-week moving average
        - claims_log_diff: Log difference (weekly change)
        - claims_trend: 4-week trend direction
        - continuing_level: Continuing claims level
        """
        features = pd.DataFrame(index=claims_df.index)
        
        # Initial claims - 4 week MA
        features['claims_4wk_ma'] = claims_df['initial_claims'].rolling(4).mean()
        
        # Log difference (captures % change better)
        features['claims_log_diff'] = np.log(claims_df['initial_claims']).diff()
        
        # Trend (4-week change)
        features['claims_trend'] = claims_df['initial_claims'].diff(4)
        
        # Continuing claims
        if 'continuing_claims' in claims_df.columns:
            features['continuing_level'] = claims_df['continuing_claims']
            features['continuing_change'] = claims_df['continuing_claims'].diff()
        
        return features
    
    def transform_ism(self, ism_df: pd.DataFrame) -> pd.DataFrame:
        """
        Transform ISM manufacturing employment index.
        
        Features:
        - ism_level: Raw ISM employment index
        - ism_vs_50: Distance from 50 (expansion/contraction)
        - ism_change: Month-over-month change
        """
        features = pd.DataFrame(index=ism_df.index)
        
        features['ism_level'] = ism_df['employment_index']
        features['ism_vs_50'] = ism_df['employment_index'] - 50
        features['ism_change'] = ism_df['employment_index'].diff()
        
        return features
    
    def transform_job_postings(self, postings_df: pd.DataFrame) -> pd.DataFrame:
        """
        Transform job postings data.
        
        Features:
        - postings_4wk_ma: 4-week moving average
        - postings_yoy: Year-over-year change
        - postings_momentum: Recent trend
        """
        features = pd.DataFrame(index=postings_df.index)
        
        features['postings_4wk_ma'] = postings_df['postings_index'].rolling(4).mean()
        features['postings_yoy'] = postings_df['postings_index'] - postings_df['postings_index'].shift(12)
        features['postings_momentum'] = postings_df['postings_index'].diff(4)
        
        return features
    
    def create_target(self, nfp_df: pd.DataFrame, thresholds: List[int]) -> pd.DataFrame:
        """
        Create binary targets for each threshold.
        
        For each threshold T, target = 1 if NFP > T, else 0
        """
        targets = pd.DataFrame(index=nfp_df.index)
        
        for threshold in thresholds:
            targets[f'nfp_gt_{threshold}'] = (nfp_df['nfp_change'] > threshold).astype(int)
            
        return targets
    
    def build_feature_matrix(
        self,
        nfp_df: pd.DataFrame,
        adp_df: Optional[pd.DataFrame] = None,
        claims_df: Optional[pd.DataFrame] = None,
        ism_df: Optional[pd.DataFrame] = None,
        postings_df: Optional[pd.DataFrame] = None,
        thresholds: List[int] = None
    ) -> tuple[pd.DataFrame, pd.DataFrame]:
        """
        Build complete feature matrix and targets.
        
        Returns:
            (features, targets): DataFrames aligned by date
        """
        features = pd.DataFrame(index=nfp_df.index)
        
        # Add each feature set if enabled and data provided
        if self.config.adp_enabled and adp_df is not None:
            adp_features = self.transform_adp(adp_df)
            features = features.join(adp_features)
            
        if self.config.claims_enabled and claims_df is not None:
            claims_features = self.transform_claims(claims_df)
            features = features.join(claims_features)
            
        if self.config.ism_enabled and ism_df is not None:
            ism_features = self.transform_ism(ism_df)
            features = features.join(ism_features)
            
        if self.config.job_postings_enabled and postings_df is not None:
            postings_features = self.transform_job_postings(postings_df)
            features = features.join(postings_features)
        
        # Create targets
        if thresholds is None:
            thresholds = [0, 50000, 100000, 150000, 200000, 250000, 300000]
        targets = self.create_target(nfp_df, thresholds)
        
        # Align and drop NaN
        common_idx = features.index.intersection(targets.index)
        features = features.loc[common_idx].dropna()
        targets = targets.loc[features.index]
        
        self.feature_names = features.columns.tolist()
        
        return features, targets


def load_mock_data() -> Dict[str, pd.DataFrame]:
    """
    Create mock data for testing feature engineering.
    Used until Grace's pipeline is ready.
    """
    dates = pd.date_range('2020-01-01', '2025-03-01', freq='MS')
    
    # Mock NFP data
    nfp = pd.DataFrame({
        'nfp_change': np.random.normal(180000, 80000, len(dates))
    }, index=dates)
    
    # Mock ADP data (released 2 days before NFP)
    adp = pd.DataFrame({
        'employment_change': nfp['nfp_change'] * 0.9 + np.random.normal(0, 50000, len(dates)),
        'consensus': nfp['nfp_change'] * 0.9 + np.random.normal(0, 30000, len(dates))
    }, index=dates)
    
    # Mock claims (weekly, we'll resample to monthly)
    weekly_dates = pd.date_range('2020-01-01', '2025-03-01', freq='W')
    claims = pd.DataFrame({
        'initial_claims': np.random.normal(220000, 30000, len(weekly_dates)),
        'continuing_claims': np.random.normal(1800000, 200000, len(weekly_dates))
    }, index=weekly_dates)
    
    # Resample claims to monthly (take last value of month)
    claims_monthly = claims.resample('MS').last()
    
    # Mock ISM
    ism = pd.DataFrame({
        'employment_index': np.random.normal(50, 5, len(dates))
    }, index=dates)
    
    # Mock job postings
    postings = pd.DataFrame({
        'postings_index': np.random.normal(100, 10, len(dates))
    }, index=dates)
    
    return {
        'nfp': nfp,
        'adp': adp,
        'claims': claims_monthly,
        'ism': ism,
        'postings': postings
    }


if __name__ == '__main__':
    # Test feature engineering
    data = load_mock_data()
    engineer = NFPFeatureEngineer()
    
    features, targets = engineer.build_feature_matrix(
        nfp_df=data['nfp'],
        adp_df=data['adp'],
        claims_df=data['claims'],
        ism_df=data['ism'],
        postings_df=data['postings']
    )
    
    print(f"Features shape: {features.shape}")
    print(f"Targets shape: {targets.shape}")
    print(f"\nFeature columns: {features.columns.tolist()}")
    print(f"\nFirst few rows:")
    print(features.head())
