const path = require('path');

// This module isn't used to build the documentation. We use Next.js for that.
// This module is used by the visual regression tests to run the demos.
module.exports = {
  context: path.resolve(__dirname),
  resolve: {
    modules: [path.join(__dirname, 'web/src'), 'node_modules'],
    alias: {},
  },
  output: {
    path: path.join(__dirname, 'build'),
    filename: 'bundle.js',
    publicPath: '/build/',
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        loader: 'babel-loader',
        query: {
          cacheDirectory: true,
        },
      },
      {
        test: /\.md$/,
        loader: 'raw-loader',
      },
      {
        test: /\.css$/,
        loader: 'style-loader!css-loader',
      },
    ],
  },
};
