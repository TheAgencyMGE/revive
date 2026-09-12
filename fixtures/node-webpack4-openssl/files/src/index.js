const { formatMetric, percentChange } = require('./format');
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
