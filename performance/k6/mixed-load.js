import { options as configure, prepare, readApi, readWorkspace, retrieval, pause } from './lib/api.js';
import { positiveInteger, mixedRoute } from './lib/configuration.js';
const maximum = positiveInteger(__ENV.MAX_VUS, 200);
const configuration = configure(50, '12m');
configuration.vus = Math.min(50, maximum);
delete configuration.duration;
export const options = {
  ...configuration,
  stages: [
    { duration: '2m', target: Math.min(50, maximum) },
    { duration: '2m', target: Math.min(100, maximum) },
    { duration: '2m', target: maximum },
    { duration: '4m', target: maximum },
    { duration: '2m', target: 0 },
  ],
};
export function setup() { return prepare(maximum); }
export default function (data) {
  const route = mixedRoute(Math.random());
  if (route === 'api-read') readApi(data);
  else if (route === 'workspace') readWorkspace(data);
  else retrieval(data);
  // At 200 VUs, 5% questions and 20s think time remain below the shared 60/minute quota.
  pause(20);
}
