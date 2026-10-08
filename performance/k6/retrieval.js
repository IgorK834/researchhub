import { options as configure, prepare, retrieval, pause } from './lib/api.js';
export const options = configure(5, '2m');
export function setup() { return prepare(options.vus); }
export default function (data) { retrieval(data); pause(15); }
