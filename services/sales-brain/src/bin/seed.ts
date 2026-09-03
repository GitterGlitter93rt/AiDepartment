/**
 * Development seed. Creates internal users and SYNTHETIC prospect inventory so the
 * portal and the acceptance flows can be exercised without touching real businesses.
 *
 * Everything here is fictional by construction:
 *   - company names use a "Northgate / Riverbend / ..." fictional set,
 *   - every phone number is in the 555-01xx range reserved for fictional use,
 *   - every domain is under example.com / example.net,
 *   - no claim is marked can_state_as_fact unless it is about the seed itself.
 *
 * Never point this at a database holding real inventory: it is additive, but the
 * accounts it creates must never be dialled or emailed.
 */
import { closePool, withTransaction, query } from '../db/pool.js';
import { createUser } from '../domain/auth.js';
import { upsertAccount, recordEvidence, upsertEndpoint } from '../domain/accounts.js';
import { syncVerticalProfiles } from '../domain/verticals.js';

const SEED_MARKER = 'seed:synthetic';

interface SeedCompany {
  name: string;
  domain: string;
  vertical: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email?: string;
  contactName?: string;
  contactTitle?: string;
  tier: 'A' | 'B' | 'C' | 'D';
  score: number;
  advertiser: 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG';
  googlePaid?: boolean;
  lsa?: boolean;
  meta?: boolean;
  hypothesis?: { category: string; text: string; question: string };
  emergency?: boolean;
}

const PLACES: { city: string; state: string; zip: string }[] = [
  { city: 'Jacksonville', state: 'FL', zip: '32256' },
  { city: 'Jacksonville', state: 'FL', zip: '32224' },
  { city: 'Jacksonville', state: 'FL', zip: '32246' },
  { city: 'St. Augustine', state: 'FL', zip: '32084' },
  { city: 'St. Augustine', state: 'FL', zip: '32086' },
  { city: 'Orange Park', state: 'FL', zip: '32073' },
];

const STEMS = [
  'Northgate', 'Riverbend', 'Blue Heron', 'Fictional Coast', 'Marsh Point', 'Sample Ridge',
  'Palm Hollow', 'Testfield', 'Cedar Landing', 'Harborline', 'Example Bay', 'Willow Creek',
  'Sandpiper', 'Quiet Harbor', 'Fairwind', 'Old Mill', 'Bright Pine', 'Sable Run',
  'Copper Lake', 'Grey Dune', 'Silver Fork', 'Tidewater Example', 'Mock Harbor', 'Placeholder Point',
];

const VERTICAL_SETUP: Record<string, {
  suffix: string;
  hypothesis: { category: string; text: string; question: string };
  emergency: boolean;
  titles: string[];
}> = {
  hvac: {
    suffix: 'Air & Heating',
    hypothesis: {
      category: 'after_hours',
      text: 'Paid emergency demand may be arriving outside staffed hours, so some calls likely go to voicemail.',
      question: 'When an emergency call comes in after hours and everyone is already on a job, what happens to it?',
    },
    emergency: true,
    titles: ['Owner', 'General Manager', 'Service Manager', 'Operations Manager', 'Office Manager'],
  },
  plumbing: {
    suffix: 'Plumbing',
    hypothesis: {
      category: 'missed_call',
      text: 'Advertised emergency plumbing implies inbound call volume the office may not always be able to answer live.',
      question: 'When two emergency calls land at once during the day, who picks up the second one?',
    },
    emergency: true,
    titles: ['Owner', 'General Manager', 'Service Manager', 'Office Manager'],
  },
  roofing: {
    suffix: 'Roofing',
    hypothesis: {
      category: 'unsold_estimate',
      text: 'Estimate-heavy roofing sales often leave unsold proposals without a consistent follow-up sequence.',
      question: 'After you hand someone a roof proposal and they go quiet, what does the follow-up look like?',
    },
    emergency: false,
    titles: ['Owner', 'Sales Manager', 'General Manager', 'Production Manager'],
  },
  electrical: {
    suffix: 'Electric',
    hypothesis: {
      category: 'speed_to_lead',
      text: 'Web form and paid leads may wait for a callback while crews are in the field.',
      question: 'When a web request comes in mid-afternoon, how long before someone actually calls them back?',
    },
    emergency: true,
    titles: ['Owner', 'Operations Manager', 'Service Manager'],
  },
  'law-firms': {
    suffix: 'Law Group',
    hypothesis: {
      category: 'speed_to_lead',
      text: 'Paid legal intake is time-sensitive and may not always be answered live during overflow.',
      question: 'When an intake call comes in and your intake team is already on the phone, where does it go?',
    },
    emergency: false,
    titles: ['Managing Partner', 'Intake Director', 'Firm Administrator', 'Operations Director'],
  },
  'collision-repair': {
    suffix: 'Collision Center',
    hypothesis: {
      category: 'customer_communication',
      text: 'Repair status updates are a common front-office load in collision operations.',
      question: 'Through a repair, who is answering the "where is my car" calls?',
    },
    emergency: false,
    titles: ['General Manager', 'Owner', 'Operations Manager', 'Office Manager'],
  },
};

function buildCompanies(): SeedCompany[] {
  const companies: SeedCompany[] = [];
  const verticals = Object.keys(VERTICAL_SETUP);
  let phoneSeq = 100;

  // Walk verticals in the outer loop so every (stem, vertical) pair is distinct.
  // A repeating pair would just be deduped into one Account, which is correct
  // behaviour but produces thin seed inventory.
  const pairs: { stem: string; vertical: string }[] = [];
  for (const vertical of verticals) {
    for (let s = 0; s < 8; s += 1) {
      pairs.push({ stem: STEMS[(verticals.indexOf(vertical) * 8 + s) % STEMS.length]!, vertical });
    }
  }

  for (let i = 0; i < pairs.length; i += 1) {
    const { stem, vertical } = pairs[i]!;
    const setup = VERTICAL_SETUP[vertical]!;
    const place = PLACES[i % PLACES.length]!;

    // Deterministic spread so filters have something meaningful to bite on.
    const tierRoll = i % 7;
    const tier: SeedCompany['tier'] = tierRoll < 2 ? 'A' : tierRoll < 4 ? 'B' : tierRoll < 6 ? 'C' : 'D';
    const score = tier === 'A' ? 13 - (i % 2) : tier === 'B' ? 10 - (i % 3) : tier === 'C' ? 7 - (i % 2) : 4;
    const advertiser: SeedCompany['advertiser'] =
      tier === 'A' ? 'STRONG' : tier === 'B' ? 'MODERATE' : tier === 'C' ? 'WEAK' : 'NONE';

    const slug = `${stem.toLowerCase().replace(/[^a-z]+/g, '')}${vertical.replace(/[^a-z]/g, '')}`;
    const hasNamedContact = i % 3 !== 2;      // roughly two thirds have a named person
    const hasEmail = i % 4 !== 3;             // roughly three quarters have an email

    phoneSeq += 1;
    const company: SeedCompany = {
      name: `${stem} ${setup.suffix}`,
      domain: `${slug}.example.com`,
      vertical,
      city: place.city, state: place.state, zip: place.zip,
      phone: `904-555-0${String(phoneSeq).padStart(3, '0')}`,
      tier, score, advertiser,
      googlePaid: tier === 'A' || tier === 'B',
      lsa: tier === 'A' && i % 2 === 0,
      meta: tier === 'A' && i % 3 === 0,
      hypothesis: setup.hypothesis,
      emergency: setup.emergency,
    };
    if (hasEmail) company.email = tier === 'D' ? `info@${slug}.example.com` : `office@${slug}.example.com`;
    if (hasNamedContact) {
      company.contactName = `${['Dana', 'Riley', 'Jordan', 'Alex', 'Morgan', 'Casey'][i % 6]} ${['Fielder', 'Marsh', 'Quill', 'Vance', 'Ober', 'Nash'][i % 6]}`;
      company.contactTitle = setup.titles[i % setup.titles.length]!;
    }
    companies.push(company);
  }
  return companies;
}

async function seedUsers(): Promise<void> {
  // Development-only credentials. Real accounts are created through `npm run user:create`.
  const password = process.env.SEED_PASSWORD ?? 'change-me-locally';
  const users: { email: string; displayName: string; role: 'SALES_REP' | 'SALES_MANAGER' | 'ADMIN' }[] = [
    { email: 'admin@youraidepartment.ai', displayName: 'Admin', role: 'ADMIN' },
    { email: 'manager@youraidepartment.ai', displayName: 'Sales Manager', role: 'SALES_MANAGER' },
    { email: 'rep1@youraidepartment.ai', displayName: 'Rep One', role: 'SALES_REP' },
    { email: 'rep2@youraidepartment.ai', displayName: 'Rep Two', role: 'SALES_REP' },
  ];
  for (const user of users) {
    await createUser({ ...user, password });
  }
  console.log(`[seed] ${users.length} users (password from SEED_PASSWORD, default "change-me-locally")`);
}

async function seedMarkets(): Promise<Map<string, string>> {
  const markets = [
    { name: 'Jacksonville HVAC Advertisers', vertical: 'hvac', type: 'city', def: { city: 'Jacksonville', state: 'FL' }, mode: 'advertiser_first' },
    { name: 'St. Augustine HVAC Advertisers', vertical: 'hvac', type: 'city', def: { city: 'St. Augustine', state: 'FL' }, mode: 'advertiser_first' },
    { name: 'Jacksonville Roofing Advertisers', vertical: 'roofing', type: 'city', def: { city: 'Jacksonville', state: 'FL' }, mode: 'advertiser_first' },
    { name: 'Jacksonville Plumbing — Full Local Market', vertical: 'plumbing', type: 'city', def: { city: 'Jacksonville', state: 'FL' }, mode: 'full_local_market' },
  ];
  const byName = new Map<string, string>();
  for (const market of markets) {
    const { rows } = await query<{ market_id: string }>(
      `insert into saved_markets (name, vertical_profile_id, geography_type, geography_definition,
                                  mining_mode, target_inventory_depth, status, last_mined_at)
       values ($1,$2,$3,$4,$5,150,'ACTIVE', now())
       returning market_id`,
      [market.name, market.vertical, market.type, JSON.stringify(market.def), market.mode],
    );
    byName.set(market.name, rows[0]!.market_id);
  }
  console.log(`[seed] ${markets.length} saved markets`);
  return byName;
}

async function seedCompanies(markets: Map<string, string>): Promise<number> {
  const companies = buildCompanies();
  let created = 0;

  for (const company of companies) {
    await withTransaction(async (client) => {
      const result = await upsertAccount(
        client,
        {
          canonicalName: company.name,
          website: `https://${company.domain}`,
          phone: company.phone,
          email: company.email ?? null,
          city: company.city, state: company.state, postalCode: company.zip,
          timezone: 'America/New_York',
          verticalProfileId: company.vertical,
          contactName: company.contactName ?? null,
          contactTitle: company.contactTitle ?? null,
        },
        { discoverySource: SEED_MARKER },
      );
      if (result.created) created += 1;

      const accountId = result.accountId;

      await client.query(
        `update accounts set manual_score = $2, manual_tier = $3, advertiser_strength = $4,
                             research_completeness = $5, last_researched_at = now(),
                             research_fresh_until = now() + interval '3 days'
          where account_id = $1`,
        [
          accountId, company.score, company.tier, company.advertiser,
          company.tier === 'D' ? 'PARTIAL' : 'GOOD',
        ],
      );

      const { rows: runRows } = await client.query<{ research_run_id: string }>(
        `insert into research_runs (account_id, trigger, vertical_profile_id, completed_at, status)
         values ($1, 'newly_discovered', $2, now(), 'completed') returning research_run_id`,
        [accountId, company.vertical],
      );
      const researchRunId = runRows[0]!.research_run_id;

      const adClaims: [string, boolean | undefined, string][] = [
        ['active_google_search_ad', company.googlePaid, 'Synthetic seed: Google paid-search evidence'],
        ['active_local_service_ad', company.lsa, 'Synthetic seed: Local Services Ad evidence'],
        ['active_meta_ad', company.meta, 'Synthetic seed: Meta ad evidence'],
      ];
      for (const [claimKey, present, text] of adClaims) {
        if (!present) continue;   // absence stays absence, never a "no" claim
        await recordEvidence(client, {
          accountId, researchRunId, category: 'advertising', claimKey,
          claimText: text, normalizedValue: 'yes', confidence: 'confirmed',
          canStateAsFact: true, sourceType: 'synthetic_seed',
          sourceReference: 'services/sales-brain/src/bin/seed.ts',
          // Ad observations expire in 48h so staleness behaviour is exercisable.
          expiresAt: new Date(Date.now() + 48 * 3600_000), precedenceRank: 6,
        });
      }

      if (company.emergency) {
        await recordEvidence(client, {
          accountId, researchRunId, category: 'website', claimKey: 'emergency_service_claim',
          claimText: 'Synthetic seed: site presents 24/7 or emergency availability',
          normalizedValue: 'yes', confidence: 'likely', canStateAsFact: false,
          sourceType: 'synthetic_seed', sourceReference: `https://${company.domain}`,
          expiresAt: new Date(Date.now() + 30 * 86_400_000), precedenceRank: 3,
        });
      }

      if (company.hypothesis) {
        await client.query(
          `insert into opportunity_hypotheses (account_id, category, hypothesis_text,
                                               missing_fact_questions, confidence, priority, generated_by)
           values ($1,$2,$3,$4,'unknown',10,'seed')`,
          [accountId, company.hypothesis.category, company.hypothesis.text, [company.hypothesis.question]],
        );
      }

      // A named contact on a Tier A company gets a direct line, so the portal can
      // show the difference between a direct line and a main line.
      if (company.contactName && company.tier === 'A') {
        const { rows: contactRows } = await client.query<{ contact_id: string }>(
          `select contact_id from contacts where account_id = $1 and status = 'ACTIVE' limit 1`, [accountId],
        );
        if (contactRows[0]) {
          await upsertEndpoint(client, {
            accountId, contactId: contactRows[0].contact_id, locationId: null,
            type: 'PHONE', rawValue: company.phone.replace(/0(\d\d)$/, '9$1'),
            endpointRole: 'DIRECT_BUSINESS_LINE', relationshipToPerson: 'DIRECT_CONFIRMED',
            qualityState: 'DIRECT_BUSINESS_CONFIRMED', source: 'COMPANY_WEBSITE',
            sourceReference: `https://${company.domain}/team`,
          });
          await client.query(
            `update contacts set role_confidence = 'LIKELY_CURRENT_ROLE', employer_match = 'LIKELY',
                                 role_match = 'STRONG_STAKEHOLDER', currentness = 'FRESH',
                                 decision_maker_priority = 10
              where contact_id = $1`,
            [contactRows[0].contact_id],
          );
        }
      }

      const marketName =
        company.vertical === 'hvac' && company.city === 'Jacksonville' ? 'Jacksonville HVAC Advertisers'
        : company.vertical === 'hvac' ? 'St. Augustine HVAC Advertisers'
        : company.vertical === 'roofing' ? 'Jacksonville Roofing Advertisers'
        : company.vertical === 'plumbing' ? 'Jacksonville Plumbing — Full Local Market'
        : null;
      const marketId = marketName ? markets.get(marketName) : null;
      if (marketId) {
        await client.query(
          `insert into account_market_membership (account_id, market_id, discovery_source)
           values ($1,$2,$3) on conflict do nothing`,
          [accountId, marketId, SEED_MARKER],
        );
      }
    });
  }
  return created;
}

await syncVerticalProfiles();
await seedUsers();
const markets = await seedMarkets();
const created = await seedCompanies(markets);
const { rows } = await query<{ n: number }>('select count(*)::int as n from accounts');
console.log(`[seed] ${created} synthetic accounts created (${rows[0]!.n} total).`);
console.log('[seed] All seed data is fictional. Never dial or email it.');
await closePool();
