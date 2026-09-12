"""Regenerate the primary offline Node fixture.

The first version of this fixture used bare ESM syntax inside a CommonJS
package, assuming Node would reject it. Node 22 enables
--experimental-detect-module by default and now runs that file happily, so the
fixture stopped reproducing a failure at all.

This version models something Node 22 still rejects outright, and which is a
far more common way for a repository to die: an ESM migration that was started
and abandoned. Someone added "type": "module" to package.json, converted
nothing else, and walked away. Every CommonJS file then breaks with
"require is not defined in ES module scope".

The historically correct repair is to remove that declaration, not to rewrite
the source into ESM -- exactly the distinction Revive exists to make.

Run: python scripts/gen_fixture_halfmigration.py
"""

import io
import json
import os
import shutil

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures")
OLD = os.path.join(ROOT, "node-esm-cjs")
F = "node-half-migration"
BASE = os.path.join(ROOT, F)


def w(rel, content):
    path = os.path.join(BASE, "files", rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    io.open(path, "w", encoding="utf-8", newline="\n").write(content)


# Start clean.
for stale in (OLD, BASE):
    if os.path.isdir(stale):
        shutil.rmtree(stale)
os.makedirs(BASE, exist_ok=True)

io.open(os.path.join(BASE, "fixture.json"), "w", encoding="utf-8", newline="\n").write(
    json.dumps(
        {
            "id": F,
            "name": "tiny-metrics",
            "title": "Abandoned half-finished ESM migration",
            "language": "node",
            "blurb": "A 2019 statistics library whose last commit added \"type\": \"module\" to package.json and converted none of the CommonJS source. Every file now fails to load.",
            "expectedFailure": "require is not defined in ES module scope",
            "expectedRepair": "Remove the incorrect ES module declaration",
            "requiresNetwork": False,
            "lastCommit": "2019-06-14T10:22:00Z",
        },
        indent=2,
    )
    + "\n"
)

# The half-applied migration: "type": "module" with CommonJS source underneath.
w(
    "package.json",
    json.dumps(
        {
            "name": "tiny-metrics",
            "version": "0.4.2",
            "description": "Tiny statistics helpers",
            "type": "module",
            "main": "src/index.js",
            "scripts": {
                "build": "node src/index.js --selftest",
                "test": "node test/metrics.test.js",
                "start": "node src/index.js",
            },
            "engines": {"node": ">=10.0.0"},
            "license": "MIT",
        },
        indent=2,
    )
    + "\n",
)

w(".nvmrc", "10.16.3\n")

w(
    "src/index.js",
    '''const { mean, median, stddev } = require('./stats.js');

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
''',
)

w(
    "src/stats.js",
    '''function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(values) {
  if (!values.length) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

module.exports = { mean, median, stddev };
''',
)

w(
    "test/metrics.test.js",
    '''const assert = require('assert');
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
''',
)

w(
    "README.md",
    '''# tiny-metrics

Tiny statistics helpers, extracted from an internal dashboard in 2019.

```js
const { summarize } = require('tiny-metrics');
summarize([1, 2, 3]);
```

## Status

Started moving to ES modules. Not finished.
''',
)

print("Regenerated fixture:", F)
