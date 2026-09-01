// Funnel registry. Adding a vertical means adding one data file and one
// entry here, plus a three-line route under src/pages/.
//
// Planned next verticals (roofing, HVAC, other legal niches) plug in the
// same way — no page template is ever copied.

import type { FunnelConfig, FunnelId } from '../../lib/funnels/types';
// Explicit .ts extensions so the Node test runner can import this
// registry directly — see the note in plumbing-ai.ts.
import { plumbingAiFunnel } from './plumbing-ai.ts';
import { personalInjuryAiFunnel } from './personal-injury-ai.ts';
import { divorceLawAiFunnel } from './divorce-law-ai.ts';

export const FUNNELS: FunnelConfig[] = [
  plumbingAiFunnel,
  personalInjuryAiFunnel,
  divorceLawAiFunnel,
];

export const FUNNELS_BY_ID: Record<FunnelId, FunnelConfig> = FUNNELS.reduce(
  (acc, funnel) => {
    acc[funnel.funnelId] = funnel;
    return acc;
  },
  {} as Record<FunnelId, FunnelConfig>,
);

export { plumbingAiFunnel, personalInjuryAiFunnel, divorceLawAiFunnel };
