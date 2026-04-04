/**
 * Risk Manager Tests — Circuit Breaker Demonstrations
 * Author: Heidi (Security Engineer)
 * Task: #237
 */

"use strict";

const { RiskManager } = require("./risk_manager");
const fs = require("fs");
const path = require("path");

// Test utilities
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
};

const assertEqual = (actual, expected, message) => {
  if (actual !== expected) {
    throw new Error(`ASSERTION FAILED: ${message}\n  Expected: ${expected}\n  Actual: ${actual}`);
  }
};

// Test state file cleanup
const TEST_STATE_FILE = "/tmp/risk_manager_test_state.json";

function cleanup() {
  try {
    if (fs.existsSync(TEST_STATE_FILE)) {
      fs.unlinkSync(TEST_STATE_FILE);
    }
  } catch (e) {
    // ignore
  }
}

// Test 1: Daily Loss Limit Circuit Breaker
async function testDailyLossLimit() {
  console.log("\n📋 Test 1: Daily Loss Limit Circuit Breaker");
  console.log("   Scenario: Accumulate losses until daily limit reached");
  
  cleanup();
  const policy = {
    dailyLossLimit: 1000, // $10 for testing
    circuitBreakerConsecutiveLosses: 100, // Disable for this test
  };
  
  const rm = new RiskManager({ policy, stateFile: TEST_STATE_FILE });
  rm.initializeCapital(100000); // $1,000
  
  // Simulate 5 losing trades of $2 each
  for (let i = 0; i < 5; i++) {
    const check = await rm.checkTrade({
      strategyId: "test-strat",
      contracts: 10,
      price: 50,
      riskAmount: 200, // $2
    });
    
    if (check.allowed) {
      await rm.recordTrade({
        strategyId: "test-strat",
        pnl: -200, // $2 loss
        contracts: 10,
        price: 50,
      });
      console.log(`   Trade ${i + 1}: Loss $2, Daily loss: $${rm.state.dailyLoss / 100}`);
    }
  }
  
  // 6th trade should be blocked
  const blocked = await rm.checkTrade({
    strategyId: "test-strat",
    contracts: 10,
    price: 50,
    riskAmount: 200,
  });
  
  assertEqual(blocked.allowed, false, "Trade should be blocked after daily loss limit");
  assert(blocked.reason.includes("Daily loss limit exceeded"), "Should indicate daily loss limit");
  assertEqual(blocked.circuitBreaker, "daily_loss_limit", "Should identify daily_loss_limit circuit breaker");
  
  console.log("   ✅ 6th trade correctly blocked");
  console.log(`   Status: Daily loss $${rm.state.dailyLoss / 100} / $${policy.dailyLossLimit / 100}`);
}

// Test 2: Consecutive Losses Circuit Breaker
async function testConsecutiveLosses() {
  console.log("\n📋 Test 2: Consecutive Losses Circuit Breaker");
  console.log("   Scenario: 5 consecutive losing trades triggers halt");
  
  cleanup();
  const policy = {
    dailyLossLimit: 100000, // High limit to not interfere
    circuitBreakerConsecutiveLosses: 5,
    circuitBreakerConsecutiveLossAmount: 100000,
  };
  
  const rm = new RiskManager({ policy, stateFile: TEST_STATE_FILE });
  rm.initializeCapital(100000);
  
  // Simulate 5 consecutive losses
  for (let i = 0; i < 5; i++) {
    const check = await rm.checkTrade({
      strategyId: "test-strat",
      contracts: 10,
      price: 50,
      riskAmount: 100,
    });
    
    assertEqual(check.allowed, true, `Trade ${i + 1} should be allowed`);
    
    await rm.recordTrade({
      strategyId: "test-strat",
      pnl: -100, // $1 loss
      contracts: 10,
      price: 50,
    });
    
    console.log(`   Trade ${i + 1}: Loss $1, Consecutive: ${rm.state.consecutiveLosses}`);
  }
  
  // After 5th loss, trading should be halted
  assertEqual(rm.state.tradingHalted, true, "Trading should be halted after 5 consecutive losses");
  assertEqual(rm.state.haltReason, "consecutive_losses", "Halt reason should be consecutive_losses");
  
  // Next trade should be blocked
  const blocked = await rm.checkTrade({
    strategyId: "test-strat",
    contracts: 10,
    price: 50,
    riskAmount: 100,
  });
  
  assertEqual(blocked.allowed, false, "Trade should be blocked after circuit breaker");
  assertEqual(blocked.circuitBreaker, "global_halt", "Should indicate global halt");
  
  console.log("   ✅ Circuit breaker triggered after 5 consecutive losses");
  console.log(`   Status: Halted=${rm.state.tradingHalted}, Reason=${rm.state.haltReason}`);
}

// Test 3: Consecutive Loss Amount Circuit Breaker
async function testConsecutiveLossAmount() {
  console.log("\n📋 Test 3: Consecutive Loss Amount Circuit Breaker");
  console.log("   Scenario: $250 cumulative consecutive loss triggers halt");
  
  cleanup();
  const policy = {
    dailyLossLimit: 100000,
    circuitBreakerConsecutiveLosses: 100, // Disable count-based
    circuitBreakerConsecutiveLossAmount: 25000, // $250
  };
  
  const rm = new RiskManager({ policy, stateFile: TEST_STATE_FILE });
  rm.initializeCapital(100000);
  
  // 3 trades of $100 each = $300 total
  for (let i = 0; i < 3; i++) {
    const check = await rm.checkTrade({
      strategyId: "test-strat",
      contracts: 20,
      price: 50,
      riskAmount: 10000,
    });
    
    if (check.allowed) {
      await rm.recordTrade({
        strategyId: "test-strat",
        pnl: -10000, // $100 loss
        contracts: 20,
        price: 50,
      });
      console.log(`   Trade ${i + 1}: Loss $100, Cumulative: $${rm.state.consecutiveLossAmount / 100}`);
    }
  }
  
  assertEqual(rm.state.tradingHalted, true, "Trading should be halted after $250+ consecutive loss");
  assertEqual(rm.state.haltReason, "consecutive_losses", "Halt reason should be consecutive_losses");
  
  console.log("   ✅ Circuit breaker triggered at $300 cumulative loss (limit: $250)");
}

// Test 4: Drawdown Circuit Breaker
async function testDrawdownCircuitBreaker() {
  console.log("\n📋 Test 4: Drawdown Circuit Breaker");
  console.log("   Scenario: 10% drawdown from peak triggers halt");
  
  cleanup();
  const policy = {
    dailyLossLimit: 100000,
    circuitBreakerConsecutiveLosses: 100,
    circuitBreakerMaxDrawdownPct: 0.10, // 10%
    circuitBreakerDrawdownAmount: 100000, // $1000
  };
  
  const rm = new RiskManager({ policy, stateFile: TEST_STATE_FILE });
  rm.initializeCapital(100000); // $1,000 starting
  
  // First, make some profit to set a higher peak
  await rm.recordTrade({
    strategyId: "test-strat",
    pnl: 50000, // $500 profit
    contracts: 10,
    price: 50,
  });
  
  console.log(`   Peak capital: $${rm.state.peakCapital / 100}`);
  
  // Now lose 11% of peak to trigger drawdown circuit breaker
  // Peak is $1500, 11% = $165
  const lossAmount = 16500; // $165
  
  // First verify the trade is allowed (drawdown check happens on next trade)
  const check = await rm.checkTrade({
    strategyId: "test-strat",
    contracts: 30,
    price: 50,
    riskAmount: lossAmount,
  });
  
  assertEqual(check.allowed, true, "Trade should be allowed (drawdown check is after trade)");
  
  // Execute the trade that causes drawdown
  await rm.recordTrade({
    strategyId: "test-strat",
    pnl: -lossAmount,
    contracts: 30,
    price: 50,
  });
  
  // Now trading should be halted
  assertEqual(rm.state.tradingHalted, true, "Trading should be halted after drawdown");
  assertEqual(rm.state.haltReason, "max_drawdown", "Halt reason should be max_drawdown");
  
  // Next trade should be blocked
  const blocked = await rm.checkTrade({
    strategyId: "test-strat",
    contracts: 10,
    price: 50,
    riskAmount: 1000,
  });
  
  assertEqual(blocked.allowed, false, "Subsequent trade should be blocked");
  
  console.log(`   Executed trade with $${lossAmount / 100} loss`);
  console.log(`   Current capital: $${rm.state.currentCapital / 100}`);
  console.log(`   Drawdown: $${(rm.state.peakCapital - rm.state.currentCapital) / 100}`);
  console.log("   ✅ Drawdown circuit breaker correctly triggered");
}

// Test 5: Per-Strategy Position Limits
async function testPerStrategyLimits() {
  console.log("\n📋 Test 5: Per-Strategy Position Limits");
  console.log("   Scenario: Strategy reaches max open positions");
  
  cleanup();
  const policy = {
    dailyLossLimit: 100000,
    circuitBreakerConsecutiveLosses: 100,
    maxOpenPositionsPerStrategy: 3,
    maxPositionSizePerStrategy: 100,
  };
  
  const rm = new RiskManager({ policy, stateFile: TEST_STATE_FILE });
  rm.initializeCapital(100000);
  
  // Open 3 positions
  for (let i = 0; i < 3; i++) {
    const check = await rm.checkTrade({
      strategyId: "mean-reversion",
      contracts: 10,
      price: 50,
      riskAmount: 500,
    });
    
    assertEqual(check.allowed, true, `Position ${i + 1} should be allowed`);
    
    await rm.recordTrade({
      strategyId: "mean-reversion",
      pnl: 0, // No P&L yet (position open)
      contracts: 10,
      price: 50,
    });
  }
  
  // 4th position should be blocked
  const blocked = await rm.checkTrade({
    strategyId: "mean-reversion",
    contracts: 10,
    price: 50,
    riskAmount: 500,
  });
  
  assertEqual(blocked.allowed, false, "4th position should be blocked");
  assert(blocked.reason.includes("Max open positions per strategy"), "Should indicate position limit");
  
  console.log("   ✅ 4th position correctly blocked");
  
  // But a different strategy should still be able to trade
  const otherStrategy = await rm.checkTrade({
    strategyId: "momentum",
    contracts: 10,
    price: 50,
    riskAmount: 500,
  });
  
  assertEqual(otherStrategy.allowed, true, "Different strategy should be allowed");
  console.log("   ✅ Other strategy can still trade");
}

// Test 6: Global Position Limits
async function testGlobalPositionLimits() {
  console.log("\n📋 Test 6: Global Position Limits");
  console.log("   Scenario: Total open positions across all strategies reaches limit");
  
  cleanup();
  const policy = {
    dailyLossLimit: 100000,
    circuitBreakerConsecutiveLosses: 100,
    maxOpenPositionsPerStrategy: 10,
    maxTotalOpenPositions: 5,
  };
  
  const rm = new RiskManager({ policy, stateFile: TEST_STATE_FILE });
  rm.initializeCapital(100000);
  
  // Open positions across different strategies
  const strategies = ["strat-a", "strat-b", "strat-c", "strat-d", "strat-e"];
  
  for (let i = 0; i < 5; i++) {
    await rm.recordTrade({
      strategyId: strategies[i],
      pnl: 0,
      contracts: 10,
      price: 50,
    });
    console.log(`   Opened position in ${strategies[i]}`);
  }
  
  // 6th position should be blocked
  const blocked = await rm.checkTrade({
    strategyId: "strat-f",
    contracts: 10,
    price: 50,
    riskAmount: 500,
  });
  
  assertEqual(blocked.allowed, false, "6th position should be blocked");
  assert(blocked.reason.includes("Global max open positions"), "Should indicate global limit");
  
  console.log("   ✅ 6th position blocked by global limit");
}

// Test 7: Winning Trade Resets Consecutive Losses
async function testWinResetsLosses() {
  console.log("\n📋 Test 7: Winning Trade Resets Consecutive Loss Counter");
  console.log("   Scenario: 3 losses, then 1 win, then more losses");
  
  cleanup();
  const policy = {
    dailyLossLimit: 100000,
    circuitBreakerConsecutiveLosses: 5,
  };
  
  const rm = new RiskManager({ policy, stateFile: TEST_STATE_FILE });
  rm.initializeCapital(100000);
  
  // 3 losses
  for (let i = 0; i < 3; i++) {
    await rm.recordTrade({
      strategyId: "test-strat",
      pnl: -100,
      contracts: 10,
      price: 50,
    });
  }
  console.log(`   After 3 losses: consecutiveLosses=${rm.state.consecutiveLosses}`);
  
  // 1 win
  await rm.recordTrade({
    strategyId: "test-strat",
    pnl: 200,
    contracts: 10,
    price: 50,
  });
  console.log(`   After 1 win: consecutiveLosses=${rm.state.consecutiveLosses}`);
  
  assertEqual(rm.state.consecutiveLosses, 0, "Consecutive losses should reset after win");
  
  // 5 more losses (should NOT trigger since counter reset)
  for (let i = 0; i < 5; i++) {
    await rm.recordTrade({
      strategyId: "test-strat",
      pnl: -100,
      contracts: 10,
      price: 50,
    });
  }
  
  assertEqual(rm.state.tradingHalted, true, "Should halt after 5 more consecutive losses");
  console.log("   ✅ Counter correctly reset by winning trade");
}

// Test 8: Manual Halt and Reset
async function testManualHaltAndReset() {
  console.log("\n📋 Test 8: Manual Halt and Reset");
  console.log("   Scenario: Manual halt, then manual reset");
  
  cleanup();
  const rm = new RiskManager({ stateFile: TEST_STATE_FILE });
  rm.initializeCapital(100000);
  
  // Manual halt
  rm.haltTrading("maintenance_window");
  
  assertEqual(rm.state.tradingHalted, true, "Should be halted");
  assertEqual(rm.state.haltReason, "maintenance_window", "Should record halt reason");
  
  const blocked = await rm.checkTrade({
    strategyId: "test-strat",
    contracts: 10,
    price: 50,
    riskAmount: 500,
  });
  assertEqual(blocked.allowed, false, "Trade should be blocked during halt");
  
  // Manual reset
  rm.resetCircuitBreakers("maintenance_complete");
  
  assertEqual(rm.state.tradingHalted, false, "Should be unhalted");
  assertEqual(rm.state.haltReason, null, "Halt reason should be cleared");
  
  const allowed = await rm.checkTrade({
    strategyId: "test-strat",
    contracts: 10,
    price: 50,
    riskAmount: 500,
  });
  assertEqual(allowed.allowed, true, "Trade should be allowed after reset");
  
  console.log("   ✅ Manual halt and reset working correctly");
}

// Test 9: Status Reporting
async function testStatusReporting() {
  console.log("\n📋 Test 9: Status Reporting");
  console.log("   Scenario: Get comprehensive risk status");
  
  cleanup();
  const rm = new RiskManager({ stateFile: TEST_STATE_FILE });
  rm.initializeCapital(100000);
  
  // Record some activity
  await rm.recordTrade({ strategyId: "strat-a", pnl: -5000, contracts: 10, price: 50 });
  await rm.recordTrade({ strategyId: "strat-a", pnl: 3000, contracts: 10, price: 50 });
  await rm.recordTrade({ strategyId: "strat-b", pnl: -2000, contracts: 10, price: 50 });
  
  const status = rm.getStatus();
  
  assertEqual(status.tradingHalted, false, "Should not be halted");
  assertEqual(status.daily.pnl, -4000, "Daily P&L should be -$40");
  assertEqual(status.positions.totalOpen, 3, "Should have 3 open positions");
  assert(status.positions.byStrategy["strat-a"], "Should have strat-a data");
  assert(status.positions.byStrategy["strat-b"], "Should have strat-b data");
  
  console.log("   ✅ Status reporting working correctly");
  console.log(`   Daily P&L: $${status.daily.pnl / 100}`);
  console.log(`   Open positions: ${status.positions.totalOpen}`);
  console.log(`   Capital: $${status.capital.current / 100}`);
}

// Test 10: Policy Updates
async function testPolicyUpdates() {
  console.log("\n📋 Test 10: Dynamic Policy Updates");
  console.log("   Scenario: Update risk policy dynamically");
  
  cleanup();
  const rm = new RiskManager({ stateFile: TEST_STATE_FILE });
  rm.initializeCapital(100000);
  
  const initialLimit = rm.policy.dailyLossLimit;
  
  // Update policy
  rm.updatePolicy({ dailyLossLimit: 25000 });
  
  assertEqual(rm.policy.dailyLossLimit, 25000, "Policy should be updated");
  
  // New limit should be enforced
  await rm.recordTrade({
    strategyId: "test-strat",
    pnl: -20000, // $200 loss
    contracts: 10,
    price: 50,
  });
  
  const blocked = await rm.checkTrade({
    strategyId: "test-strat",
    contracts: 10,
    price: 50,
    riskAmount: 10000,
  });
  
  assertEqual(blocked.allowed, false, "Should respect new lower limit");
  
  console.log("   ✅ Dynamic policy updates working");
  console.log(`   Old limit: $${initialLimit / 100}, New limit: $${rm.policy.dailyLossLimit / 100}`);
}

// Main test runner
async function runAllTests() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Risk Manager Test Suite — Circuit Breaker Demonstrations");
  console.log("  Task #237 — Heidi (Security Engineer)");
  console.log("═══════════════════════════════════════════════════════════");
  
  const tests = [
    testDailyLossLimit,
    testConsecutiveLosses,
    testConsecutiveLossAmount,
    testDrawdownCircuitBreaker,
    testPerStrategyLimits,
    testGlobalPositionLimits,
    testWinResetsLosses,
    testManualHaltAndReset,
    testStatusReporting,
    testPolicyUpdates,
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (e) {
      failed++;
      console.error(`\n   ❌ FAILED: ${e.message}`);
    }
  }
  
  cleanup();
  
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════════════");
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run if executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = { runAllTests };
