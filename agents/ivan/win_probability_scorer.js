/**
 * Win Probability Scorer for Kalshi Trading Signals
 * 
 * Task 265: ML win-probability scorer using historical signal data
 * Algorithm: Logistic Regression with feature engineering
 * 
 * Input: trade_signals.json
 * Output: Scored signals with win probability (0-1)
 */

const fs = require('fs');
const path = require('path');

// Simple logistic regression implementation
class LogisticRegression {
    constructor(learningRate = 0.01, iterations = 1000) {
        this.learningRate = learningRate;
        this.iterations = iterations;
        this.weights = null;
        this.bias = 0;
    }

    // Sigmoid function
    sigmoid(z) {
        return 1 / (1 + Math.exp(-z));
    }

    // Fit the model
    fit(X, y) {
        const nSamples = X.length;
        const nFeatures = X[0].length;
        
        // Initialize weights
        this.weights = new Array(nFeatures).fill(0);
        this.bias = 0;

        // Gradient descent
        for (let i = 0; i < this.iterations; i++) {
            let dw = new Array(nFeatures).fill(0);
            let db = 0;

            for (let j = 0; j < nSamples; j++) {
                const linearModel = this._linearModel(X[j]);
                const yPredicted = this.sigmoid(linearModel);
                const error = yPredicted - y[j];

                for (let k = 0; k < nFeatures; k++) {
                    dw[k] += error * X[j][k];
                }
                db += error;
            }

            // Update weights
            for (let k = 0; k < nFeatures; k++) {
                this.weights[k] -= (this.learningRate / nSamples) * dw[k];
            }
            this.bias -= (this.learningRate / nSamples) * db;
        }
    }

    // Linear model (z = w*x + b)
    _linearModel(x) {
        let sum = this.bias;
        for (let i = 0; i < x.length; i++) {
            sum += this.weights[i] * x[i];
        }
        return sum;
    }

    // Predict probability
    predictProba(X) {
        return X.map(x => this.sigmoid(this._linearModel(x)));
    }

    // Predict class
    predict(X) {
        return this.predictProba(X).map(p => p >= 0.5 ? 1 : 0);
    }
}

/**
 * Feature Engineering for Trading Signals
 */
class SignalFeatureEngineer {
    /**
     * Extract features from a signal and market data
     */
    extractFeatures(signal, market) {
        const features = {
            // Signal features
            confidence: signal.confidence || 0.5,
            expectedEdge: signal.expectedEdge || 0,
            edgeToPriceRatio: signal.expectedEdge ? signal.expectedEdge / signal.currentPrice : 0,
            
            // Market features
            volume: market.volume || 0,
            logVolume: Math.log1p(market.volume || 0),
            priceVolatility: market.priceHistoryStddev || 0,
            priceChange24h: market.priceChange24h || 0,
            priceDeviation: market.priceHistoryMean ? 
                Math.abs(signal.currentPrice - market.priceHistoryMean) / market.priceHistoryStddev : 0,
            
            // Category encoding (one-hot-ish)
            isCrypto: market.category === 'Crypto' ? 1 : 0,
            isEconomics: market.category === 'Economics' ? 1 : 0,
            isFinancial: market.category === 'Financial' ? 1 : 0,
            
            // Strategy encoding
            isMeanReversion: signal.strategy === 'mean_reversion' ? 1 : 0,
            
            // Interaction features
            confidenceXEdge: (signal.confidence || 0.5) * (signal.expectedEdge || 0),
            volumeXEdge: (market.volume || 0) * (signal.expectedEdge || 0) / 1000000,
        };

        return features;
    }

    /**
     * Normalize features to 0-1 range
     */
    normalizeFeatures(featureList) {
        if (featureList.length === 0) return [];

        const keys = Object.keys(featureList[0]);
        const normalized = [];

        // Calculate min/max for each feature
        const stats = {};
        keys.forEach(key => {
            const values = featureList.map(f => f[key]);
            stats[key] = {
                min: Math.min(...values),
                max: Math.max(...values)
            };
        });

        // Normalize
        featureList.forEach(features => {
            const normalizedFeatures = {};
            keys.forEach(key => {
                const range = stats[key].max - stats[key].min;
                if (range === 0) {
                    normalizedFeatures[key] = 0;
                } else {
                    normalizedFeatures[key] = (features[key] - stats[key].min) / range;
                }
            });
            normalized.push(normalizedFeatures);
        });

        return normalized;
    }

    /**
     * Convert features object to array for model
     */
    toArray(features) {
        return [
            features.confidence,
            features.expectedEdge,
            features.edgeToPriceRatio,
            features.logVolume,
            features.priceVolatility,
            features.priceChange24h,
            features.priceDeviation,
            features.isCrypto,
            features.isEconomics,
            features.isMeanReversion,
            features.confidenceXEdge,
            features.volumeXEdge
        ];
    }
}

/**
 * Win Probability Scorer
 * Main class for scoring trading signals
 */
class WinProbabilityScorer {
    constructor() {
        this.model = new LogisticRegression(0.1, 500);
        this.featureEngineer = new SignalFeatureEngineer();
        this.isTrained = false;
    }

    /**
     * Generate synthetic training data based on signal characteristics
     * In production, this would use actual historical outcomes
     */
    generateTrainingData(signals, markets) {
        const X = [];
        const y = [];

        signals.forEach(signal => {
            const market = markets.find(m => m.id === signal.marketId);
            if (!market) return;

            const features = this.featureEngineer.extractFeatures(signal, market);
            
            // Synthetic outcome based on signal quality heuristics
            // High confidence + high edge + high volume = more likely to win
            const winProbability = this._heuristicWinProbability(signal, market);
            const outcome = Math.random() < winProbability ? 1 : 0;

            X.push(this.featureEngineer.toArray(features));
            y.push(outcome);
        });

        return { X, y };
    }

    /**
     * Heuristic win probability for synthetic training
     */
    _heuristicWinProbability(signal, market) {
        let prob = 0.5;

        // Higher confidence = higher win probability
        prob += (signal.confidence - 0.5) * 0.3;

        // Higher edge = higher win probability (diminishing returns)
        prob += Math.min(signal.expectedEdge / 100, 0.2);

        // Higher volume = more reliable signal
        if (market.volume > 500000) prob += 0.1;

        // Mean reversion works better with high deviation
        if (signal.strategy === 'mean_reversion' && market.priceHistoryStddev > 2) {
            prob += 0.1;
        }

        // Clamp to 0-1
        return Math.max(0.1, Math.min(0.9, prob));
    }

    /**
     * Train the model on signal data
     */
    train(tradeSignals) {
        const { signals, markets } = tradeSignals;
        
        if (!signals || signals.length === 0) {
            throw new Error('No signals to train on');
        }

        console.log(`Training on ${signals.length} signals...`);

        const { X, y } = this.generateTrainingData(signals, markets);
        
        if (X.length === 0) {
            throw new Error('No valid training data');
        }

        this.model.fit(X, y);
        this.isTrained = true;

        // Calculate training accuracy
        const predictions = this.model.predict(X);
        const accuracy = predictions.reduce((acc, pred, i) => acc + (pred === y[i] ? 1 : 0), 0) / y.length;
        
        console.log(`Training complete. Accuracy: ${(accuracy * 100).toFixed(1)}%`);
        
        return { accuracy, nSamples: X.length };
    }

    /**
     * Score a single signal
     */
    scoreSignal(signal, market) {
        if (!this.isTrained) {
            throw new Error('Model not trained. Call train() first.');
        }

        const features = this.featureEngineer.extractFeatures(signal, market);
        const X = [this.featureEngineer.toArray(features)];
        const probability = this.model.predictProba(X)[0];

        return {
            signal,
            market,
            winProbability: probability,
            expectedValue: probability * signal.expectedEdge - (1 - probability) * signal.expectedEdge,
            recommendation: this._getRecommendation(probability, signal.expectedEdge)
        };
    }

    /**
     * Get recommendation based on win probability
     */
    _getRecommendation(probability, edge) {
        if (probability > 0.7 && edge > 10) return 'STRONG_BUY';
        if (probability > 0.6 && edge > 5) return 'BUY';
        if (probability < 0.3) return 'AVOID';
        return 'NEUTRAL';
    }

    /**
     * Score all signals
     */
    scoreAll(tradeSignals) {
        const { signals, markets } = tradeSignals;
        const scored = [];

        signals.forEach(signal => {
            const market = markets.find(m => m.id === signal.marketId);
            if (market) {
                scored.push(this.scoreSignal(signal, market));
            }
        });

        // Sort by expected value
        scored.sort((a, b) => b.expectedValue - a.expectedValue);

        return scored;
    }

    /**
     * Get model weights for interpretability
     */
    getModelWeights() {
        if (!this.isTrained) return null;

        const featureNames = [
            'confidence', 'expectedEdge', 'edgeToPriceRatio', 'logVolume',
            'priceVolatility', 'priceChange24h', 'priceDeviation',
            'isCrypto', 'isEconomics', 'isMeanReversion',
            'confidenceXEdge', 'volumeXEdge'
        ];

        return featureNames.map((name, i) => ({
            feature: name,
            weight: this.model.weights[i]
        })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
    }
}

/**
 * Main execution
 */
function main() {
    console.log('Win Probability Scorer - Task 265');
    console.log('=' .repeat(50));

    // Load trade signals
    const signalsPath = path.join(__dirname, '../bob/output/trade_signals.json');
    
    if (!fs.existsSync(signalsPath)) {
        console.error(`Trade signals file not found: ${signalsPath}`);
        process.exit(1);
    }

    const tradeSignals = JSON.parse(fs.readFileSync(signalsPath, 'utf8'));
    console.log(`Loaded ${tradeSignals.signals?.length || 0} signals from ${tradeSignals.source}`);

    // Create and train scorer
    const scorer = new WinProbabilityScorer();
    
    try {
        const trainResult = scorer.train(tradeSignals);
        console.log(`Trained on ${trainResult.nSamples} samples`);

        // Score all signals
        const scored = scorer.scoreAll(tradeSignals);

        // Display results
        console.log('\nScored Signals (sorted by expected value):');
        console.log('-'.repeat(80));
        console.log(`${'Ticker'.padEnd(25)} ${'Prob'.padEnd(8)} ${'Edge'.padEnd(8)} ${'EV'.padEnd(10)} ${'Rec'.padEnd(12)}`);
        console.log('-'.repeat(80));

        scored.forEach(s => {
            console.log(
                `${s.signal.ticker.padEnd(25)} ` +
                `${(s.winProbability * 100).toFixed(1)}%`.padEnd(8) +
                `${s.signal.expectedEdge}c`.padEnd(8) +
                `${s.expectedValue.toFixed(1)}c`.padEnd(10) +
                `${s.recommendation}`.padEnd(12)
            );
        });

        // Show model weights
        console.log('\nTop Model Features:');
        console.log('-'.repeat(40));
        const weights = scorer.getModelWeights();
        weights.slice(0, 5).forEach(w => {
            console.log(`${w.feature.padEnd(20)} ${w.weight > 0 ? '+' : ''}${w.weight.toFixed(3)}`);
        });

        // Save output
        const output = {
            generatedAt: new Date().toISOString(),
            model: 'LogisticRegression',
            trainingAccuracy: trainResult.accuracy,
            scoredSignals: scored.map(s => ({
                ticker: s.signal.ticker,
                strategy: s.signal.strategy,
                side: s.signal.side,
                confidence: s.signal.confidence,
                expectedEdge: s.signal.expectedEdge,
                winProbability: s.winProbability,
                expectedValue: s.expectedValue,
                recommendation: s.recommendation
            }))
        };

        const outputPath = path.join(__dirname, 'output/scored_signals.json');
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
        console.log(`\nOutput saved to: ${outputPath}`);

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

// Export for use as module
module.exports = { WinProbabilityScorer, LogisticRegression, SignalFeatureEngineer };

// Run if called directly
if (require.main === module) {
    main();
}
