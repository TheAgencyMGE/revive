"""Generate the Node.js demo fixtures that exercise registry-dependent failures.

These three need network access because the failures they reproduce happen
during dependency installation. The offline fixtures in gen_fixtures.py cover
the demo path when the network is unavailable.

Run: python scripts/gen_fixtures_node.py
"""

import io
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures")


def w(fixture, rel, content):
    path = os.path.join(ROOT, fixture, "files", rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    io.open(path, "w", encoding="utf-8", newline="\n").write(content)


def wj(fixture, rel, obj):
    w(fixture, rel, json.dumps(obj, indent=2) + "\n")


def meta(fixture, data):
    path = os.path.join(ROOT, fixture, "fixture.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    io.open(path, "w", encoding="utf-8", newline="\n").write(json.dumps(data, indent=2) + "\n")


# ===========================================================================
# node-sass-legacy — deprecated native module with no binary for modern Node
# ===========================================================================
F = "node-sass-legacy"
meta(F, {
    "id": F,
    "name": "retro-ui",
    "title": "node-sass has no binary for this Node version",
    "language": "node",
    "blurb": "A 2018 component library styled with SCSS. node-sass was deprecated in 2020 and ships no prebuilt binary for any recent Node, so installation fails or falls back to a source build.",
    "expectedFailure": "node-sass / Missing binding",
    "expectedRepair": "Replace node-sass with dart-sass",
    "requiresNetwork": True,
    "lastCommit": "2018-04-11T08:45:00Z",
})

wj(F, "package.json", {
    "name": "retro-ui",
    "version": "1.3.0",
    "description": "A small SCSS component library",
    "main": "dist/index.js",
    "scripts": {
        "build": "node scripts/build-styles.js",
        "test": "node test/build.test.js",
    },
    "engines": {"node": ">=8.0.0"},
    "devDependencies": {
        "node-sass": "4.9.0",
    },
    "license": "MIT",
})

w(F, ".nvmrc", "8.11.1\n")

w(F, "scripts/build-styles.js", '''/* Compiles the SCSS entrypoint to dist/retro.css. */
const fs = require('fs');
const path = require('path');

// Historically this was node-sass; dart-sass exposes the same renderSync API.
let sass;
try {
  sass = require('node-sass');
} catch (err) {
  sass = require('sass');
}

const SRC = path.join(__dirname, '..', 'src', 'retro.scss');
const OUT_DIR = path.join(__dirname, '..', 'dist');
const OUT = path.join(OUT_DIR, 'retro.css');

const result = sass.renderSync({ file: SRC, outputStyle: 'expanded' });

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, result.css);

console.log('wrote ' + OUT + ' (' + result.css.length + ' bytes)');
''')

w(F, "src/retro.scss", '''$primary: #2f6f4f;
$radius: 4px;
$spacing: 8px;

@mixin button-base {
  display: inline-block;
  padding: $spacing ($spacing * 2);
  border-radius: $radius;
  border: 1px solid darken($primary, 10%);
  cursor: pointer;
}

.btn {
  @include button-base;
  background: $primary;
  color: #fff;

  &:hover {
    background: darken($primary, 6%);
  }

  &--ghost {
    background: transparent;
    color: $primary;
  }
}

.card {
  padding: $spacing * 2;
  border-radius: $radius;
  border: 1px solid rgba(0, 0, 0, 0.12);

  &__title {
    margin: 0 0 $spacing;
    font-weight: 600;
  }
}
''')

w(F, "test/build.test.js", '''const assert = require('assert');
const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'dist', 'retro.css');

assert.ok(fs.existsSync(cssPath), 'dist/retro.css should exist after build');

const css = fs.readFileSync(cssPath, 'utf8');
assert.ok(css.includes('.btn'), 'expected .btn rule');
assert.ok(css.includes('.card__title'), 'expected nested BEM selector to compile');
assert.ok(!css.includes('$primary'), 'variables should be resolved');

console.log('style build verified');
''')

w(F, "README.md", '''# retro-ui

A small SCSS component library.

    npm install
    npm run build

Requires Node 8.
''')


# ===========================================================================
# node-webpack4-openssl — webpack 4 MD4 hashing vs OpenSSL 3
# ===========================================================================
F = "node-webpack4-openssl"
meta(F, {
    "id": F,
    "name": "dashboard-bundle",
    "title": "Webpack 4 crashes on the OpenSSL 3 provider",
    "language": "node",
    "blurb": "A 2019 dashboard bundled with webpack 4. Webpack 4 hashes with MD4, which OpenSSL 3 removed, so the build dies on Node 17 and newer with ERR_OSSL_EVP_UNSUPPORTED.",
    "expectedFailure": "error:0308010C:digital envelope routines::unsupported",
    "expectedRepair": "Re-enable the legacy OpenSSL provider for webpack 4",
    "requiresNetwork": True,
    "lastCommit": "2019-09-30T13:20:00Z",
})

wj(F, "package.json", {
    "name": "dashboard-bundle",
    "version": "2.1.4",
    "private": True,
    "scripts": {
        "build": "webpack --mode production",
        "test": "node test/bundle.test.js",
    },
    "engines": {"node": ">=10.0.0 <15"},
    "devDependencies": {
        "webpack": "4.41.2",
        "webpack-cli": "3.3.10",
    },
})

w(F, ".nvmrc", "12.13.0\n")

w(F, "webpack.config.js", '''const path = require('path');

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'dashboard.[contenthash].js',
    library: 'Dashboard',
    libraryTarget: 'umd',
  },
  resolve: {
    extensions: ['.js'],
  },
  performance: {
    hints: false,
  },
};
''')

w(F, "src/index.js", '''const { formatMetric, percentChange } = require('./format');
const { Series } = require('./series');

function renderSummary(points) {
  const series = new Series(points);
  return {
    latest: formatMetric(series.latest()),
    change: percentChange(series.first(), series.latest()),
    total: formatMetric(series.total()),
  };
}

module.exports = { renderSummary, Series, formatMetric, percentChange };
''')

w(F, "src/format.js", '''function formatMetric(value) {
  if (value === null || value === undefined) return '-';
  if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(1) + 'M';
  if (Math.abs(value) >= 1000) return (value / 1000).toFixed(1) + 'k';
  return String(value);
}

function percentChange(from, to) {
  if (!from) return 0;
  return Math.round(((to - from) / from) * 1000) / 10;
}

module.exports = { formatMetric, percentChange };
''')

w(F, "src/series.js", '''class Series {
  constructor(points) {
    this.points = Array.isArray(points) ? points.slice() : [];
  }

  first() {
    return this.points.length ? this.points[0] : 0;
  }

  latest() {
    return this.points.length ? this.points[this.points.length - 1] : 0;
  }

  total() {
    return this.points.reduce(function (sum, p) {
      return sum + p;
    }, 0);
  }
}

module.exports = { Series };
''')

w(F, "test/bundle.test.js", '''const assert = require('assert');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
assert.ok(fs.existsSync(distDir), 'dist/ should exist after a successful build');

const bundles = fs.readdirSync(distDir).filter((f) => f.endsWith('.js'));
assert.ok(bundles.length > 0, 'expected at least one emitted bundle');

const bundle = fs.readFileSync(path.join(distDir, bundles[0]), 'utf8');
assert.ok(bundle.length > 200, 'bundle looks suspiciously small');

console.log('bundle verified:', bundles[0]);
''')

w(F, "README.md", '''# dashboard-bundle

UMD bundle for the metrics dashboard widgets.

    npm install
    npm run build

Built with webpack 4 on Node 12.
''')


# ===========================================================================
# node-peer-conflict — npm 7+ turns peer conflicts into hard errors
# ===========================================================================
F = "node-peer-conflict"
meta(F, {
    "id": F,
    "name": "chart-widgets",
    "title": "Peer dependency conflict blocks installation",
    "language": "node",
    "blurb": "A React dashboard widget pack abandoned mid-upgrade: react was bumped to 17 but react-dom was left at 16, which declares a hard peer dependency on React 16. npm 6 installed it silently; npm 7 made that a fatal ERESOLVE.",
    "expectedFailure": "ERESOLVE unable to resolve dependency tree",
    "expectedRepair": "Install with legacy peer dependency resolution",
    "requiresNetwork": True,
    "lastCommit": "2018-12-05T17:10:00Z",
})

wj(F, "package.json", {
    "name": "chart-widgets",
    "version": "0.9.1",
    "description": "Chart widgets for React dashboards",
    "main": "index.js",
    "scripts": {
        "build": "node scripts/check-deps.js",
        "test": "node test/widgets.test.js",
    },
    "engines": {"node": ">=8.0.0"},
    "dependencies": {
        "react": "16.8.6",
        "react-dom": "16.8.6",
        # react-addons-shallow-compare declares a peer range of ^15.x, which
        # npm 7+ refuses to reconcile against React 16.
        "react-addons-shallow-compare": "15.6.2",
    },
    "license": "MIT",
})

w(F, ".nvmrc", "10.15.0\n")

w(F, "index.js", '''const { formatSeries, axisTicks } = require('./src/axis');

module.exports = { formatSeries, axisTicks };
''')

w(F, "src/axis.js", '''/** Produce evenly spaced axis ticks covering the data range. */
function axisTicks(values, desired) {
  const count = desired || 5;
  if (!values.length) return [];
  const min = Math.min.apply(null, values);
  const max = Math.max.apply(null, values);
  if (min === max) return [min];

  const step = (max - min) / (count - 1);
  const ticks = [];
  for (let i = 0; i < count; i++) {
    ticks.push(Math.round((min + step * i) * 100) / 100);
  }
  return ticks;
}

/** Normalise a series into {x, y} pairs. */
function formatSeries(values) {
  return values.map(function (value, index) {
    return { x: index, y: value };
  });
}

module.exports = { axisTicks, formatSeries };
''')

w(F, "scripts/check-deps.js", '''/* Stands in for the original build: verifies the dependency tree resolved. */
const assert = require('assert');

const react = require('react/package.json');
assert.ok(react.version.startsWith('16.'), 'expected React 16, got ' + react.version);

console.log('dependency tree resolved; react ' + react.version);
''')

w(F, "test/widgets.test.js", '''const assert = require('assert');
const { axisTicks, formatSeries } = require('../index');

assert.deepStrictEqual(axisTicks([0, 10], 3), [0, 5, 10]);
assert.deepStrictEqual(axisTicks([5, 5]), [5]);
assert.deepStrictEqual(axisTicks([]), []);

const series = formatSeries([3, 6]);
assert.deepStrictEqual(series, [{ x: 0, y: 3 }, { x: 1, y: 6 }]);

console.log('widget tests passed');
''')

w(F, "README.md", '''# chart-widgets

Chart primitives for React 16 dashboards.

    npm install
    npm test
''')


print("Generated Node fixtures: node-sass-legacy, node-webpack4-openssl, node-peer-conflict")
