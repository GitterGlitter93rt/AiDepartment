import { config } from '../config.js';
import { buildServer } from '../api/server.js';

// Discovery providers. Registered in both processes so the API answers "can this
// system find a new business" the same way the worker would; registering an
// unconfigured adapter changes nothing, because availability is decided by the
// credential and the governance review rather than by the import.
const { registerConfiguredDiscoveryAdapters } = await import('../miner/registry.js');
const availableProviders = registerConfiguredDiscoveryAdapters();
import { closePool } from '../db/pool.js';

const app = await buildServer();

// Say out loud when the running build and the database disagree. The API still
// starts: refusing would take the portal down over a schema step somebody is about
// to run, and a portal that starts and says what is wrong is more useful than one
// that will not start and says the same thing to nobody.
app.log.info(
  { providers: availableProviders },
  availableProviders.length > 0
    ? 'discovery providers configured'
    : 'no discovery provider is configured; market search can only refresh existing inventory');

try {
  const { schemaState } = await import('../db/migrate.js');
  const schema = await schemaState();
  if (schema.pending.length > 0) {
    app.log.error({ pending: schema.pending },
      'migrations in this build have not been applied to this database; run npm run migrate');
  }
  if (schema.changed.length > 0) {
    app.log.error({ changed: schema.changed },
      'migrations were edited after being applied; the database does not contain what this build expects');
  }
  if (schema.unknown.length > 0) {
    app.log.warn({ unknown: schema.unknown },
      'this database has migrations this build does not; the running code is older than the schema');
  }
} catch (error) {
  app.log.error({ err: error }, 'could not read the schema state; is PostgreSQL up?');
}

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
