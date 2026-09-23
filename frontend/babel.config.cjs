/**
 * Shared Babel configuration for the Webpack build and for ESLint (@babel/eslint-parser).
 *
 * `@babel/preset-react` is applied only to `.jsx`/`.tsx` via `overrides`. Enabling the JSX
 * syntax plugin for plain `.ts` files makes a generic arrow function such as
 * `<TResponse>(path: string) => ...` parse as a JSX element, which breaks both the build and
 * the linter. `@babel/preset-typescript` turns on TSX support from the file extension itself.
 */
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { esmodules: true } }],
    '@babel/preset-typescript',
  ],
  overrides: [
    {
      test: /\.(jsx|tsx)$/,
      presets: [['@babel/preset-react', { runtime: 'automatic' }]],
    },
  ],
};
