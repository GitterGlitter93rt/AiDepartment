import { registerDiscoveryAdapter, availableDiscoveryAdapters } from '../workers/marketMiner.js';
import { createDataForSeoAdapter, dataForSeoConfig } from './dataForSeoAdapter.js';

/**
 * Wiring the discovery providers into the registry the miner reads.
 *
 * Everything about the provider path was built, tested and made durable -- the
 * result contract, the task table, the payload, the budget -- and nothing ever
 * called registerDiscoveryAdapter with it. `availableDiscoveryAdapters()` returned
 * an empty list no matter what was in the environment, so a correctly credentialled
 * DataForSEO account would still have produced DISCOVERY_BLOCKED on every search.
 * "Add the credentials" would not have worked.
 *
 * Registered by both processes, deliberately. The worker needs it to search; the API
 * needs it to answer "can this system find a new business" the same way the worker
 * would. A registry that differs between the two is how a page comes to say
 * discovery is unavailable while the worker is busy discovering.
 *
 * Registering is not enabling. The adapter reports itself unconfigured until the
 * credential, the enable flag and the signed governance review are all present, and
 * `availableDiscoveryAdapters()` filters on exactly that -- so calling this on a box
 * with no credentials changes nothing.
 */
export function registerConfiguredDiscoveryAdapters(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const config = dataForSeoConfig(env);
  registerDiscoveryAdapter(createDataForSeoAdapter({ config }));
  return availableDiscoveryAdapters().map((adapter) => adapter.name);
}
