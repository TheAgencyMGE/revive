const path = require('path');

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
