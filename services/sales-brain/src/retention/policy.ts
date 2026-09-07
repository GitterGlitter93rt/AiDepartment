/**
 * How long each kind of row is kept.
 *
 * Deliberately empty until somebody supplies it. Nothing prunes anything in this
 * system today, and choosing the periods is a business decision about what the
 * provenance behind "you are running this ad" is worth keeping -- not something an
 * engine should decide on its owner's behalf, and not something to guess at while
 * nobody is watching. INPUT-006 in brain/TODO.md is where that decision lives.
 *
 * So this file describes the shape of a policy and ships without one. A plan built
 * from no policy reports what exists and how old it is, and proposes deleting
 * nothing.
 */

export interface TableRetention {
  table: string;
  /** The timestamp column that dates a row. */
  timestamp: string;
  /**
   * Keep rows younger than this. Null means keep everything, which is the default
   * for every table until a period is set.
   */
  keepDays: number | null;
  /**
   * Per retention_class overrides, for tables that carry one. A class named here
   * wins over keepDays.
   */
  byClass?: Record<string, number | null>;
  /** Why this table can be pruned at all, in words. */
  rationale: string;
}

export interface RetentionPolicy {
  /** Set by whoever supplies the policy, so a plan can say whose decision it is. */
  approvedBy: string | null;
  approvedAt: string | null;
  tables: TableRetention[];
}

/**
 * The tables that grow with running time, and the column that dates each row.
 *
 * Every `keepDays` is null: this is the inventory of what *could* be pruned, with no
 * decision attached. A table absent from this list is never a candidate, whatever a
 * policy says -- which is how `accounts`, `contacts` and the sales history stay out
 * of reach of a mistake in a config file.
 */
export const PRUNABLE_TABLES: TableRetention[] = [
  {
    table: 'search_observations', timestamp: 'observed_at', keepDays: null,
    byClass: { transient: null, identifier_only: null, durable: null },
    rationale: 'One row per business per search. The fastest-growing table, and the '
      + 'record of how a company was found, which is the evidence behind what a rep '
      + 'says on a call.',
  },
  {
    table: 'provider_usage', timestamp: 'requested_at', keepDays: null,
    rationale: 'One row per provider call. The cost record: needed to reconcile an '
      + 'invoice, and of little use after that reconciliation has happened.',
  },
  {
    table: 'jobs', timestamp: 'created_at', keepDays: null,
    rationale: 'One row per run. A completed job is operational exhaust once its '
      + 'outcome has been read.',
  },
  {
    table: 'provider_tasks', timestamp: 'submitted_at', keepDays: null,
    rationale: 'One row per submitted search. A collected or abandoned task is a '
      + 'closed transaction.',
  },
  {
    table: 'research_runs', timestamp: 'started_at', keepDays: null,
    rationale: 'One row per research attempt. Superseded by the evidence it produced.',
  },
  {
    table: 'canonical_scores', timestamp: 'calculated_at', keepDays: null,
    rationale: 'Append-only score history. Only the newest is read; the rest are an '
      + 'audit trail of how a company came to be ranked.',
  },
  {
    table: 'login_attempts', timestamp: 'attempted_at', keepDays: null,
    rationale: 'Sign-in attempts, already pruned hourly by housekeeping at one day.',
  },
];

/** No policy: nothing is prunable and the plan says so. */
export const NO_POLICY: RetentionPolicy = {
  approvedBy: null, approvedAt: null, tables: PRUNABLE_TABLES,
};

/**
 * Reads a policy from disk when one exists.
 *
 * A malformed policy is refused rather than partly applied: a retention config that
 * half-parses is a config that deletes the wrong things.
 */
export async function loadPolicy(path: string | null): Promise<{
  policy: RetentionPolicy; error: string | null;
}> {
  if (!path) return { policy: NO_POLICY, error: null };

  const { readFileSync } = await import('node:fs');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { policy: NO_POLICY, error: `${path} is not readable JSON: `
      + `${(error as Error).message}` };
  }

  const candidate = raw as Partial<RetentionPolicy>;
  if (!candidate.approvedBy) {
    return { policy: NO_POLICY,
      error: 'A retention policy has to say who approved it. Deleting a customer '
        + "record is somebody's decision and the plan names them." };
  }
  if (!Array.isArray(candidate.tables)) {
    return { policy: NO_POLICY, error: 'A retention policy needs a `tables` array.' };
  }

  const known = new Map(PRUNABLE_TABLES.map((entry) => [entry.table, entry]));
  const unknown = candidate.tables
    .map((entry) => entry.table)
    .filter((table) => !known.has(table));
  if (unknown.length > 0) {
    return { policy: NO_POLICY,
      error: 'These tables are not prunable and never will be from a config file: '
        + `${unknown.join(', ')}. Accounts, contacts and sales history are out of `
        + 'reach of a mistake in a policy by design.' };
  }

  // Merged onto the inventory, so a policy naming three tables leaves the rest
  // keeping everything rather than defaulting them to something.
  const tables = PRUNABLE_TABLES.map((entry) => {
    const supplied = candidate.tables!.find((table) => table.table === entry.table);
    return supplied ? { ...entry, ...supplied } : entry;
  });

  return {
    policy: {
      approvedBy: candidate.approvedBy,
      approvedAt: candidate.approvedAt ?? new Date().toISOString(),
      tables,
    },
    error: null,
  };
}
