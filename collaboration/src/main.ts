import { configuration } from './config.js';
import { createService, log } from './service.js';
const server = createService(configuration());
await server.listen();
log('service.started');
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  void server.destroy().then(() => process.exit(0));
});
