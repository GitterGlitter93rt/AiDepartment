import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { config } from '../config.js';
import { query } from '../db/pool.js';

/**
 * Loads the versioned vertical profiles from docs/09-software/ into the database.
 * The repository files stay the authority; this is a cache so runtime queries and
 * Call Packs can pin a profile version.
 * Authority: vertical-profile-registry.v1.yaml, vertical-profile-schema.md.
 */

const repoRoot = resolve(config.packageRoot, '..', '..');
const registryPath = resolve(repoRoot, 'docs/09-software/vertical-profile-registry.v1.yaml');

interface RegistryEntry {
  profile_id: string;
  path: string;
  manual_priority: number;
  implementation_wave: number;
  mining_strength: string;
  enabled_architecture: boolean;
}

export interface VerticalProfile {
  id: string;
  registryId: string;
  displayName: string;
  version: string;
  priority: number;
  wave: number;
  miningStrength: string;
  definition: Record<string, unknown>;
}

/** 'hvac-us-v1' -> 'hvac'. The short id is what reps see in filters and URLs. */
export function shortProfileId(registryId: string): string {
  return registryId.replace(/-us-v\d+$/, '').replace(/-v\d+$/, '');
}

export function loadVerticalProfilesFromRepo(): VerticalProfile[] {
  if (!existsSync(registryPath)) {
    throw new Error(`Vertical profile registry not found at ${registryPath}`);
  }
  const registry = parseYaml(readFileSync(registryPath, 'utf8')) as { profiles: RegistryEntry[] };
  const profiles: VerticalProfile[] = [];

  for (const entry of registry.profiles ?? []) {
    const profilePath = resolve(repoRoot, entry.path);
    // A registry entry without a file is an architecture placeholder, not an error.
    if (!existsSync(profilePath)) continue;

    const definition = parseYaml(readFileSync(profilePath, 'utf8')) as Record<string, unknown>;
    profiles.push({
      id: shortProfileId(entry.profile_id),
      registryId: entry.profile_id,
      displayName: String(definition['industry_name'] ?? entry.profile_id),
      version: String(definition['version'] ?? '1.0.0'),
      priority: entry.manual_priority,
      wave: entry.implementation_wave,
      miningStrength: entry.mining_strength,
      definition,
    });
  }
  return profiles.sort((a, b) => a.priority - b.priority);
}

export async function syncVerticalProfiles(): Promise<number> {
  const profiles = loadVerticalProfilesFromRepo();
  for (const profile of profiles) {
    await query(
      `insert into vertical_profiles (vertical_profile_id, display_name, profile_version, definition, is_active)
       values ($1, $2, $3, $4, true)
       on conflict (vertical_profile_id) do update
          set display_name = excluded.display_name,
              profile_version = excluded.profile_version,
              definition = excluded.definition,
              is_active = true,
              updated_at = now()`,
      [
        profile.id, profile.displayName, profile.version,
        JSON.stringify({
          registry_id: profile.registryId,
          priority: profile.priority,
          wave: profile.wave,
          mining_strength: profile.miningStrength,
          profile: profile.definition,
        }),
      ],
    );
  }
  return profiles.length;
}

export interface VerticalOption {
  id: string;
  displayName: string;
  priority: number;
}

export async function listVerticals(): Promise<VerticalOption[]> {
  const { rows } = await query<{ vertical_profile_id: string; display_name: string; definition: any }>(
    `select vertical_profile_id, display_name, definition from vertical_profiles
      where is_active order by (definition->>'priority')::int nulls last, display_name`,
  );
  return rows.map((row) => ({
    id: row.vertical_profile_id,
    displayName: row.display_name,
    priority: Number(row.definition?.priority ?? 99),
  }));
}

export async function getVerticalProfile(verticalProfileId: string): Promise<any | null> {
  const { rows } = await query<{ definition: any }>(
    'select definition from vertical_profiles where vertical_profile_id = $1', [verticalProfileId],
  );
  return rows[0]?.definition?.profile ?? null;
}
