/**
 * Build-time values injected by Webpack's DefinePlugin (see webpack.config.cjs).
 *
 * Only `RESEARCHHUB_`-prefixed public values are available in the bundle. There is no real
 * `process` object in the browser: DefinePlugin replaces these exact member expressions with
 * string literals at build time, so only the keys declared here may be read.
 */
declare const process: {
  readonly env: {
    /**
     * Origin the API client prefixes onto request paths. Empty string means same-origin.
     *
     * Typed as optional on purpose: the Webpack build always defines it, but a test runner or
     * any other consumer of these modules does not, so readers must handle `undefined`.
     */
    readonly RESEARCHHUB_API_BASE_URL?: string;
  };
};
