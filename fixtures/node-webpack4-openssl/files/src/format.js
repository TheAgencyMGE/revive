function formatMetric(value) {
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
