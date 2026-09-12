const assert = require('assert');
const { summarize } = require('../src/index.js');
const { mean, median, stddev } = require('../src/stats.js');

assert.strictEqual(mean([1, 2, 3]), 2);
assert.strictEqual(median([1, 3, 2]), 2);
assert.strictEqual(median([1, 2, 3, 4]), 2.5);
assert.strictEqual(Math.round(stddev([2, 4, 4, 4, 5, 5, 7, 9]) * 100) / 100, 2);

const summary = summarize([2, 4, 4, 4, 5, 5, 7, 9]);
assert.strictEqual(summary.count, 8);
assert.strictEqual(summary.mean, 5);
assert.strictEqual(summary.median, 4.5);

console.log('all tests passed');
