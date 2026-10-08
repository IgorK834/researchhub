import { options as configure, prepare, readApi, pause } from './lib/api.js';
export const options = configure(5, '2m');
export function setup() { return prepare(options.vus); }
export default function (data) { readApi(data); pause(); }
