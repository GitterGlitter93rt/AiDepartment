import { config } from '../config.js';
import { buildServer } from '../api/server.js';
import { closePool } from '../db/pool.js';

const app = await buildServer();

try {
  await app.listen({ port: config.portal.port, host: config.portal.bind });
  app.log.info(
    { mode: config.contactEnrichmentMode, outboundDial: config.outbound.dialEnabled },
    `YAD Sales Brain API listening on http://${config.portal.bind}:${config.portal.port}`,
  );
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await closePool();
    process.exit(0);
  });
}
