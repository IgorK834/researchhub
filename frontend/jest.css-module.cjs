// Preserve class names in component tests without pretending jsdom lays out CSS.
module.exports = new Proxy(
  {},
  {
    get: (_target, key) => (key === '__esModule' ? false : key),
  },
);
