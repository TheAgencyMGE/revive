const assert = require('assert');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
assert.ok(fs.existsSync(distDir), 'dist/ should exist after a successful build');

const bundles = fs.readdirSync(distDir).filter((f) => f.endsWith('.js'));
assert.ok(bundles.length > 0, 'expected at least one emitted bundle');

const bundle = fs.readFileSync(path.join(distDir, bundles[0]), 'utf8');
assert.ok(bundle.length > 200, 'bundle looks suspiciously small');

console.log('bundle verified:', bundles[0]);
