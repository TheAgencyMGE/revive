"""Make the peer-conflict fixture actually conflict.

The first version pinned react-addons-shallow-compare, whose peer range modern
npm resolves without complaint -- so the fixture reported "already working",
which is worse than useless as a demo.

This version models the most common real cause of ERESOLVE in abandoned React
projects: someone bumped react to 17 and never bumped react-dom, which declares
a hard peer dependency on react ^16.14.0. npm 6 installed that combination
silently; npm 7+ refuses.

Also removes the stale `main` entry from the node-sass fixture, which pointed at
a dist/ file the build does not produce and so failed the start probe for a
reason unrelated to what that fixture demonstrates.

Run once: python scripts/fix_peer_fixture.py
"""

import io
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures")


def write(fixture, rel, content):
    path = os.path.join(ROOT, fixture, "files", rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    io.open(path, "w", encoding="utf-8", newline="\n").write(content)


# ---------------------------------------------------------------------------
# node-peer-conflict
# ---------------------------------------------------------------------------
F = "node-peer-conflict"

write(
    F,
    "package.json",
    json.dumps(
        {
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
                # react was bumped to 17 during a half-finished upgrade...
                "react": "17.0.2",
                # ...but react-dom was left at 16, and it declares a hard peer
                # dependency on react ^16.14.0. npm 6 ignored the conflict;
                # npm 7+ makes it a fatal ERESOLVE.
                "react-dom": "16.14.0",
            },
            "license": "MIT",
        },
        indent=2,
    )
    + "\n",
)

write(
    F,
    "scripts/check-deps.js",
    """/* Stands in for the original build: verifies the dependency tree resolved. */
const assert = require('assert');

const react = require('react/package.json');
const reactDom = require('react-dom/package.json');

assert.ok(react.version, 'react should be installed');
assert.ok(reactDom.version, 'react-dom should be installed');

console.log('dependency tree resolved; react ' + react.version + ', react-dom ' + reactDom.version);
""",
)

write(
    F,
    "README.md",
    """# chart-widgets

Chart primitives for React dashboards.

    npm install
    npm test

## Status

Mid-upgrade to React 17. react-dom has not been bumped yet.
""",
)

# ---------------------------------------------------------------------------
# node-sass-legacy: drop the `main` that points at an unbuilt file
# ---------------------------------------------------------------------------
sass_pkg = os.path.join(ROOT, "node-sass-legacy", "files", "package.json")
data = json.load(io.open(sass_pkg, encoding="utf-8"))
data.pop("main", None)
io.open(sass_pkg, "w", encoding="utf-8", newline="\n").write(json.dumps(data, indent=2) + "\n")

print("Updated node-peer-conflict (react 17 vs react-dom 16) and node-sass-legacy")
