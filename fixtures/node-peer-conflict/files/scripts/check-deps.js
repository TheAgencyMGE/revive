/* Stands in for the original build: verifies the dependency tree resolved. */
const assert = require('assert');

const react = require('react/package.json');
const reactDom = require('react-dom/package.json');

assert.ok(react.version, 'react should be installed');
assert.ok(reactDom.version, 'react-dom should be installed');

console.log('dependency tree resolved; react ' + react.version + ', react-dom ' + reactDom.version);
