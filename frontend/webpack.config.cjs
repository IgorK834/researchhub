const path = require('path');
const fs = require('node:fs');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { browserPolicy } = require('./security/browserPolicy.cjs');

/**
 * Public, non-secret build-time values are prefixed `RESEARCHHUB_` and injected with
 * DefinePlugin. See docs/development/configuration.md — anything with that prefix can end up
 * in the browser bundle, so backend/Azure secrets must never be passed here.
 *
 * `RESEARCHHUB_API_BASE_URL` defaults to an empty string, which makes the API client issue
 * same-origin relative requests (`/api/...`, `/actuator/...`). In development the dev server
 * proxies those to the backend on port 8080, so no CORS configuration is needed on the Spring
 * side. Set the variable explicitly when the API lives on another origin.
 */
const apiBaseUrl = process.env.RESEARCHHUB_API_BASE_URL ?? '';

/** Backend origin the dev server proxies API and Actuator calls to. */
const devApiTarget = process.env.RESEARCHHUB_DEV_API_TARGET ?? 'http://localhost:8080';

/** @param {{ WEBPACK_SERVE?: boolean }} env */
module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  const security = isProduction ? browserPolicy(process.env) : undefined;
  const cssLoader = isProduction ? MiniCssExtractPlugin.loader : 'style-loader';

  return {
    mode: isProduction ? 'production' : 'development',
    entry: path.resolve(__dirname, 'src/index.tsx'),
    output: {
      path: path.resolve(__dirname, 'dist'),
      // Absolute, so index.html references `/main.js` and still resolves on nested client routes
      // such as /app/workspaces/<id>/sources/<id>. The app is served from the origin root
      // (AppRouter has no basename), in development and in whatever hosts dist/.
      publicPath: '/',
      filename: isProduction ? '[name].[contenthash].js' : '[name].js',
      clean: true,
    },
    devtool: isProduction ? 'source-map' : 'eval-source-map',
    resolve: {
      extensions: ['.tsx', '.ts', '.jsx', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.(ts|tsx|js|jsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            // `--mode` does not set NODE_ENV for Babel, which would otherwise default to
            // "development" and emit the dev-only `jsxDEV` transform into production bundles.
            options: { envName: isProduction ? 'production' : 'development' },
          },
        },
        {
          test: /\.css$/,
          // Only *.module.css is scoped; tokens, base styles and fonts remain global.
          oneOf: [
            {
              test: /\.module\.css$/,
              use: [
                cssLoader,
                {
                  loader: 'css-loader',
                  options: {
                    modules: {
                      namedExport: false,
                      exportLocalsConvention: 'as-is',
                      localIdentName: isProduction
                        ? 'rh_[hash:base64:8]'
                        : 'rh_[name]__[local]__[hash:base64:5]',
                    },
                  },
                },
              ],
            },
            {
              use: [cssLoader, { loader: 'css-loader', options: { modules: false } }],
            },
          ],
        },
        {
          // SVG imports are URLs, never implicit React components or inline HTML.
          test: /\.(woff2?|ttf|otf|eot|svg|png)$/i,
          type: 'asset/resource',
          generator: { filename: 'assets/[name].[contenthash][ext]' },
        },
      ],
    },
    plugins: [
      {
        // Font binaries and icon artwork must travel with their redistribution notices.
        apply(compiler) {
          compiler.hooks.thisCompilation.tap('ResearchHubNotices', (compilation) => {
            compilation.hooks.processAssets.tap(
              {
                name: 'ResearchHubNotices',
                stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
              },
              () => {
                if (security) {
                  compilation.emitAsset(
                    'security-headers.json',
                    new webpack.sources.RawSource(JSON.stringify(security, null, 2)),
                  );
                }
                compilation.emitAsset(
                  'THIRD_PARTY_NOTICES.txt',
                  new webpack.sources.RawSource(
                    fs.readFileSync(path.resolve(__dirname, 'THIRD_PARTY_NOTICES.md')),
                  ),
                );
              },
            );
          });
        },
      },
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, 'public/index.html'),
        meta: security
          ? {
              'Content-Security-Policy': {
                'http-equiv': 'Content-Security-Policy',
                content: security.metaCsp,
              },
            }
          : {},
      }),
      ...(isProduction
        ? [new MiniCssExtractPlugin({ filename: '[name].[contenthash].css' })]
        : []),
      new webpack.DefinePlugin({
        'process.env.RESEARCHHUB_API_BASE_URL': JSON.stringify(apiBaseUrl),
        'process.env.RESEARCHHUB_COLLABORATION_ENABLED': JSON.stringify(
          process.env.RESEARCHHUB_COLLABORATION_ENABLED ?? 'false',
        ),
      }),
    ],
    devServer: {
      port: 3000,
      open: false,
      historyApiFallback: true,
      static: {
        directory: path.resolve(__dirname, 'public'),
      },
      // Same-origin proxy so the browser never makes a cross-origin call in development.
      // webpack-dev-server 5+ requires the array form.
      proxy: [
        {
          context: ['/api', '/actuator'],
          target: devApiTarget,
        },
      ],
    },
  };
};
