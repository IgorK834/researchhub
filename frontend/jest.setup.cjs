/**
 * jsdom does not implement TextEncoder/TextDecoder, and React Router 7 reaches for TextEncoder at import
 * time, so without these a component test fails before it renders anything. Node's implementations are
 * spec-compliant, so they are simply handed to the jsdom global.
 *
 * Kept deliberately minimal. Polyfilling MessageChannel from node:worker_threads also works but opens
 * real ports that keep the event loop alive, so Jest never exits.
 */
const { TextEncoder, TextDecoder } = require('node:util');

if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = TextDecoder;
}
