const assert = require('assert');
const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'dist', 'retro.css');

assert.ok(fs.existsSync(cssPath), 'dist/retro.css should exist after build');

const css = fs.readFileSync(cssPath, 'utf8');
assert.ok(css.includes('.btn'), 'expected .btn rule');
assert.ok(css.includes('.card__title'), 'expected nested BEM selector to compile');
assert.ok(!css.includes('$primary'), 'variables should be resolved');

console.log('style build verified');
