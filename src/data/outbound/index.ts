// Cold-email outbound landing-page registry.
//
// Adding a campaign vertical means adding one data file and one entry
// here, plus a three-line route under src/pages/go/ — never copying a
// page template.
//
// This is deliberately a SEPARATE registry from src/data/funnels/. The
// paid-social funnels answer to a different contract (a priced offer,
// nine sections, a VSL) and tests/paidSocialFunnels.test.ts enforces it
// on every member of FUNNELS. Merging the two registries would mean
// either weakening that contract or writing a hollow offer section
// here. See the header of src/lib/outbound/types.ts.

import type { OutboundCampaignId, OutboundConfig } from '../../lib/outbound/types';
// Explicit .ts extensions so the Node test runner can import this
// registry directly, matching src/data/funnels/index.ts.
import { lawFirmsOutbound } from './law-firms.ts';
import { roofingOutbound } from './roofing.ts';

export const OUTBOUND_PAGES: OutboundConfig[] = [lawFirmsOutbound, roofingOutbound];

export const OUTBOUND_BY_CAMPAIGN: Record<OutboundCampaignId, OutboundConfig> = OUTBOUND_PAGES.reduce(
  (acc, page) => {
    acc[page.campaignId] = page;
    return acc;
  },
  {} as Record<OutboundCampaignId, OutboundConfig>,
);

export { lawFirmsOutbound, roofingOutbound };
