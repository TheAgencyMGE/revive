class Series {
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
