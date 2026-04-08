const fs = require('fs');
const path = require('path');

/**
 * Benchmark Sequential vs Parallel Data Fetching
 */

async function mockFetch(id, delay) {
  return new Promise(resolve => setTimeout(() => resolve(`Data for ${id}`), delay));
}

async function benchmark() {
  const numItems = 20;
  const delayPerItem = 100; // ms
  
  console.log(`\nBenchmarking ${numItems} items with ${delayPerItem}ms delay...`);
  
  // 1. Sequential
  const startSeq = Date.now();
  const resultsSeq = [];
  for (let i = 0; i < numItems; i++) {
    resultsSeq.push(await mockFetch(i, delayPerItem));
  }
  const durationSeq = Date.now() - startSeq;
  console.log(`Sequential: ${durationSeq}ms`);
  
  // 2. Parallel
  const startPar = Date.now();
  const resultsPar = await Promise.all(
    Array.from({ length: numItems }, (_, i) => mockFetch(i, delayPerItem))
  );
  const durationPar = Date.now() - startPar;
  console.log(`Parallel: ${durationPar}ms`);
  
  console.log(`Speedup: ${(durationSeq / durationPar).toFixed(2)}x`);
}

benchmark();
