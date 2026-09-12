const assert = require('assert');
const { axisTicks, formatSeries } = require('../index');

assert.deepStrictEqual(axisTicks([0, 10], 3), [0, 5, 10]);
assert.deepStrictEqual(axisTicks([5, 5]), [5]);
assert.deepStrictEqual(axisTicks([]), []);

const series = formatSeries([3, 6]);
assert.deepStrictEqual(series, [{ x: 0, y: 3 }, { x: 1, y: 6 }]);

console.log('widget tests passed');
