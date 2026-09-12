const { mean, median, stddev } = require('./stats.js');

const SAMPLE = [2, 4, 4, 4, 5, 5, 7, 9];

function summarize(values) {
  return {
    count: values.length,
    mean: mean(values),
    median: median(values),
    stddev: stddev(values),
  };
}

if (process.argv.includes('--selftest')) {
  const result = summarize(SAMPLE);
  if (result.mean !== 5) {
    throw new Error('mean regression: expected 5, got ' + result.mean);
  }
  console.log('selftest ok:', JSON.stringify(result));
}

module.exports = { summarize };
