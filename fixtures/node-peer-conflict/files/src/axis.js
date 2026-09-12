/** Produce evenly spaced axis ticks covering the data range. */
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
