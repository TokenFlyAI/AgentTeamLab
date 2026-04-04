/**
 * Sprint 8 Arbitrage Pipeline Integration Tests
 * 
 * Test the Kalshi arbitrage 4-phase pipeline end-to-end:
 * 1. Market Filtering (Grace)
 * 2. LLM-Based Clustering (Ivan)
 * 3. Pearson Correlation Detection (Bob)
 * 4. C++ Execution Engine Design (Dave) — design phase validation
 * 
 * Run: npm test -- tests/sprint8_arbitrage_pipeline.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('Sprint 8: Kalshi Arbitrage Pipeline', () => {
  
  const PUBLIC_DIR = path.join(__dirname, '..', 'agents/public');
  
  describe('Phase 1: Market Filtering (Grace — T343)', () => {
    it('should load filtered markets JSON', () => {
      const filePath = path.join(PUBLIC_DIR, 'markets_filtered.json');
      assert(fs.existsSync(filePath), 'markets_filtered.json should exist');
      
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      assert(content.markets, 'should have markets array');
      assert(Array.isArray(content.markets), 'markets should be an array');
    });
    
    it('filtered markets should have valid structure', () => {
      const content = JSON.parse(
        fs.readFileSync(path.join(PUBLIC_DIR, 'markets_filtered.json'), 'utf-8')
      );
      
      content.markets.forEach(market => {
        assert(market.name, 'market should have name');
        assert(typeof market.volume === 'number', 'market should have volume');
        assert(typeof market.yes_ratio === 'number', 'market should have yes_ratio');
        assert(market.yes_ratio >= 0 && market.yes_ratio <= 1, 'yes_ratio should be [0,1]');
      });
    });
  });
  
  describe('Phase 2: LLM-Based Clustering (Ivan — T344)', () => {
    it('should load market clusters JSON', () => {
      const filePath = path.join(PUBLIC_DIR, 'market_clusters.json');
      assert(fs.existsSync(filePath), 'market_clusters.json should exist');
      
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      assert(content.clusters, 'should have clusters');
      assert(Array.isArray(content.clusters), 'clusters should be an array');
    });
    
    it('clusters should identify related markets', () => {
      const content = JSON.parse(
        fs.readFileSync(path.join(PUBLIC_DIR, 'market_clusters.json'), 'utf-8')
      );
      
      assert(content.clusters.length >= 3, 'should have at least 3 clusters');
    });
  });
  
  describe('Phase 3: Pearson Correlation Detection (Bob — T345)', () => {
    it('should load correlation pairs JSON', () => {
      const filePath = path.join(PUBLIC_DIR, 'correlation_pairs.json');
      assert(fs.existsSync(filePath), 'correlation_pairs.json should exist');
      
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      assert(content.pairs, 'should have pairs array');
      assert(Array.isArray(content.pairs), 'pairs should be an array');
    });
    
    it('pairs should have valid correlation metrics', () => {
      const content = JSON.parse(
        fs.readFileSync(path.join(PUBLIC_DIR, 'correlation_pairs.json'), 'utf-8')
      );
      
      content.pairs.forEach(pair => {
        assert(pair.market_a, 'pair should have market_a');
        assert(pair.market_b, 'pair should have market_b');
        assert(typeof pair.pearson_correlation === 'number', 'should have pearson_correlation');
        assert(pair.pearson_correlation >= -1 && pair.pearson_correlation <= 1,
          'correlation should be in [-1, 1]');
      });
    });
    
    it('should identify arbitrage opportunities', () => {
      const content = JSON.parse(
        fs.readFileSync(path.join(PUBLIC_DIR, 'correlation_pairs.json'), 'utf-8')
      );
      
      assert(content.arbitrage_opportunities > 0, 'should find arbitrage opportunities');
    });
  });
  
  describe('Pipeline Integration', () => {
    it('all phase outputs should be present', () => {
      const files = [
        'markets_filtered.json',
        'market_clusters.json',
        'correlation_pairs.json'
      ];
      
      files.forEach(file => {
        const filePath = path.join(PUBLIC_DIR, file);
        assert(fs.existsSync(filePath), `${file} should exist`);
      });
    });
  });
  
});
