import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { query, withTransaction, type Queryable } from '../db/pool.js';
import { upsertAccount, upsertEndpoint, recordEvidence, roleCategoryFromTitle } from '../domain/accounts.js';
import { normalizeEmail, normalizePhone, classifyEmail } from '../domain/normalize.js';
import { parseCsv, detectDelimiter } from './csv.js';
import { applyColumnMap, inferColumnMap, verticalHintFor, type ColumnMap, type MappedRow } from './mapping.js';

/**
 * List import.
 * Authority: market-miner-lead-import-export-spec.md.
 *
 * An imported list is a discovery source, not a trusted canonical Account. A row
 * cannot bypass dedupe, suppression or contact history, and importing never starts
 * outreach (`import_batches.outreach_on_import` is CHECKed false in the schema).
 */

export interface ImportOptions {
  sourceName: string;
  sourceKind?: 'csv' | 'airtable_export' | 'apollo_export' | 'manual' | 'other';
  defaultVerticalProfileId?: string | null;
  importedBy?: string | null;
  /** Preview without writing anything. */
  dryRun?: boolean;
  columnMap?: ColumnMap;
}

export interface ImportReport {
  importBatchId: string | null;
  sourceName: string;
  columnMap: ColumnMap;
  unmappedHeaders: string[];
  rows: number;
  created: number;
  matched: number;
  rejected: number;
  suppressed: number;
  matchRules: Record<string, number>;
  quality: {
    uniqueAccounts: number;
    duplicatePercent: number;
    websitesResolved: number;
    phonesResolved: number;
    emailsResolved: number;
    namedContacts: number;
    verticalMatched: number;
    verticalUnknown: number;
  };
  rejections: { line: number; reason: string; company: string | null }[];
}

/** A row is usable if it identifies a business at all. */
function rejectReason(row: MappedRow): string | null {
  if (!row.company && !row.domain) return 'no company name or website';
  if (row.company && row.company.length < 2) return 'company name too short to identify a business';
  if (!row.phone && !row.directPhone && !row.email && !row.domain) {
    return 'no website, phone or email — nothing to research or contact';
  }
  return null;
}

export async function importCsvFile(path: string, options: ImportOptions): Promise<ImportReport> {
  const content = readFileSync(path, 'utf8');
  const sha256 = createHash('sha256').update(content).digest('hex');
  return importCsvContent(content, {
    ...options,
    sourceName: options.sourceName || basename(path),
  }, { fileName: basename(path), sha256 });
}

export async function importCsvContent(
  content: string,
  options: ImportOptions,
  file: { fileName?: string; sha256?: string } = {},
): Promise<ImportReport> {
  const parsed = parseCsv(content, detectDelimiter(content));
  const columnMap = options.columnMap ?? inferColumnMap(parsed.headers);
  const mappedColumns = new Set(Object.values(columnMap));
  const unmappedHeaders = parsed.headers.filter((header) => !mappedColumns.has(header));

  const report: ImportReport = {
    importBatchId: null,
    sourceName: options.sourceName,
    columnMap,
    unmappedHeaders,
    rows: parsed.rows.length,
    created: 0, matched: 0, rejected: 0, suppressed: 0,
    matchRules: {},
    quality: {
      uniqueAccounts: 0, duplicatePercent: 0, websitesResolved: 0, phonesResolved: 0,
      emailsResolved: 0, namedContacts: 0, verticalMatched: 0, verticalUnknown: 0,
    },
    rejections: [],
  };

  if (parsed.rows.length === 0) return report;

  let batchId: string | null = null;
  if (!options.dryRun) {
    // A re-uploaded identical file is refused rather than double-imported.
    if (file.sha256) {
      const existing = await query<{ import_batch_id: string; source_name: string }>(
        'select import_batch_id, source_name from import_batches where file_sha256 = $1', [file.sha256],
      );
      if (existing.rows[0]) {
        throw new Error(
          `This exact file was already imported as "${existing.rows[0].source_name}" ` +
          `(batch ${existing.rows[0].import_batch_id}). Nothing was imported again.`,
        );
      }
    }
    const { rows } = await query<{ import_batch_id: string }>(
      `insert into import_batches (source_name, source_kind, file_name, file_sha256, row_count,
                                   status, default_vertical_profile_id, created_by)
       values ($1,$2,$3,$4,$5,'RUNNING',$6,$7) returning import_batch_id`,
      [
        options.sourceName, options.sourceKind ?? 'csv', file.fileName ?? null, file.sha256 ?? null,
        parsed.rows.length, options.defaultVerticalProfileId ?? null, options.importedBy ?? null,
      ],
    );
    batchId = rows[0]!.import_batch_id;
    report.importBatchId = batchId;
  }

  // Only assign a vertical the database actually knows about. A coarse or unknown
  // source taxonomy must not reject a good prospect (import spec §10) and must not
  // blow up the import on a foreign key either — the raw industry label is kept
  // either way, and research can classify the account later.
  const knownVerticals = new Set(
    (await query<{ vertical_profile_id: string }>(
      'select vertical_profile_id from vertical_profiles where is_active',
    )).rows.map((row) => row.vertical_profile_id),
  );
  if (options.defaultVerticalProfileId && !knownVerticals.has(options.defaultVerticalProfileId)) {
    throw new Error(
      `Unknown vertical profile "${options.defaultVerticalProfileId}". ` +
      'Run `npm run sync-verticals` or pass one that exists.',
    );
  }

  const seenAccounts = new Set<string>();

  try {
  for (let index = 0; index < parsed.rows.length; index += 1) {
    const raw = parsed.rows[index]!;
    const line = parsed.lineNumbers[index]!;
    const mapped = applyColumnMap(raw, columnMap);

    const reason = rejectReason(mapped);
    if (reason) {
      report.rejected += 1;
      report.rejections.push({ line, reason, company: mapped.company });
      if (batchId) await recordRow(batchId, index + 1, raw, mapped, 'REJECTED', null, null, reason);
      continue;
    }

    if (mapped.domain) report.quality.websitesResolved += 1;
    if (mapped.phone || mapped.directPhone) report.quality.phonesResolved += 1;
    if (mapped.email) report.quality.emailsResolved += 1;
    if (mapped.contactName) report.quality.namedContacts += 1;

    // Source industry is a hint. An explicit default beats a guess; neither is evidence.
    const hinted = options.defaultVerticalProfileId ?? verticalHintFor(mapped.industry);
    const vertical = hinted && knownVerticals.has(hinted) ? hinted : null;
    if (vertical) report.quality.verticalMatched += 1;
    else if (hinted) report.quality.verticalUnknown += 1;

    if (options.dryRun) {
      report.created += 1;
      continue;
    }

    const outcome = await withTransaction(async (client) => {
      const result = await upsertAccount(
        client,
        {
          canonicalName: mapped.company ?? mapped.domain!,
          website: mapped.domain,
          phone: mapped.phone,
          email: mapped.email,
          addressLine1: mapped.address,
          city: mapped.city,
          state: mapped.state,
          postalCode: mapped.postalCode,
          verticalProfileId: vertical,
          industryCode: mapped.industry,
          contactName: mapped.contactName,
          contactTitle: mapped.contactTitle,
          sourceIdentity: mapped.providerId
            ? {
                provider: options.sourceKind === 'apollo_export' ? 'apollo' : options.sourceName,
                entityType: 'account',
                nativeId: mapped.providerId,
                retentionClass: 'durable_with_license',
              }
            : null,
        },
        { discoverySource: 'import', importBatchId: batchId, actorUserId: options.importedBy ?? null },
      );

      // A direct phone from a list is provider-asserted, never YAD-confirmed.
      if (mapped.directPhone) {
        const { rows: contactRows } = await client.query<{ contact_id: string }>(
          `select contact_id from contacts where account_id = $1 and status = 'ACTIVE'
            order by created_at limit 1`,
          [result.accountId],
        );
        await upsertEndpoint(client, {
          accountId: result.accountId,
          contactId: contactRows[0]?.contact_id ?? null,
          locationId: null,
          type: 'PHONE',
          rawValue: mapped.directPhone,
          endpointRole: 'DIRECT_BUSINESS_LINE',
          relationshipToPerson: 'DIRECT_PROVIDER_ASSERTED',
          qualityState: 'PROVIDER_ASSERTED_CURRENT',
          source: options.sourceKind === 'apollo_export' ? 'PAID_PROVIDER' : 'IMPORT',
          sourceReference: options.sourceName,
        });
      }

      if (mapped.contactTitle && mapped.contactName) {
        // The list asserts a title. Recorded as an import-sourced claim that cannot
        // be spoken as fact until something current corroborates it.
        await recordEvidence(client, {
          accountId: result.accountId,
          category: 'decision_maker',
          claimKey: 'imported_contact_title',
          claimText: `${mapped.contactName} listed as "${mapped.contactTitle}" in ${options.sourceName}`,
          normalizedValue: roleCategoryFromTitle(mapped.contactTitle),
          confidence: 'unknown',
          canStateAsFact: false,
          sourceType: 'import',
          sourceProvider: options.sourceName,
          sourceReference: options.sourceName,
          precedenceRank: 6,
          notes: 'Imported list title. Role currentness is unverified.',
        });
      }

      // Suppression check: an import must never resurrect a DNC.
      const { rows: suppressionRows } = await client.query<{ n: number }>(
        `select count(*)::int as n from suppressions
          where is_active and account_id = $1 and (expires_at is null or expires_at > now())`,
        [result.accountId],
      );
      const isSuppressed = (suppressionRows[0]?.n ?? 0) > 0;

      await recordRow(
        batchId!, index + 1, raw, mapped,
        isSuppressed ? 'SUPPRESSED' : result.created ? 'CREATED' : 'MATCHED',
        result.matchRule, result.accountId, null, client,
      );

      return { ...result, isSuppressed };
    });

    seenAccounts.add(outcome.accountId);
    report.matchRules[outcome.matchRule] = (report.matchRules[outcome.matchRule] ?? 0) + 1;
    if (outcome.isSuppressed) report.suppressed += 1;
    if (outcome.created) report.created += 1;
    else report.matched += 1;
  }

  } catch (error) {
    // Never leave a batch stuck in RUNNING: a partial import must be visible as failed,
    // with the rows it did commit still attributed to it.
    if (batchId) {
      await query(
        `update import_batches set status = 'FAILED', completed_at = now(),
                accounts_created = $2, accounts_matched = $3, rows_rejected = $4, rows_suppressed = $5,
                notes = $6
          where import_batch_id = $1`,
        [batchId, report.created, report.matched, report.rejected, report.suppressed,
         `Failed after ${report.created + report.matched} rows: ${(error as Error).message}`],
      );
    }
    throw error;
  }

  const usableRows = report.rows - report.rejected;
  report.quality.uniqueAccounts = options.dryRun ? report.created : seenAccounts.size;
  report.quality.duplicatePercent = usableRows > 0
    ? Math.round(((usableRows - report.quality.uniqueAccounts) / usableRows) * 1000) / 10
    : 0;

  if (batchId) {
    await query(
      `update import_batches set status = 'COMPLETED', completed_at = now(),
              accounts_created = $2, accounts_matched = $3, rows_rejected = $4, rows_suppressed = $5
        where import_batch_id = $1`,
      [batchId, report.created, report.matched, report.rejected, report.suppressed],
    );
  }

  return report;
}

async function recordRow(
  batchId: string, rowNumber: number, raw: Record<string, string>, normalized: MappedRow,
  outcome: string, matchRule: string | null, accountId: string | null,
  rejectReasonText: string | null, client?: Queryable,
): Promise<void> {
  // Bind: pg's client.query relies on `this`, so the method must not be detached.
  const run: (text: string, values: unknown[]) => Promise<unknown> =
    client ? (text, values) => client.query(text, values) : (text, values) => query(text, values);
  // The raw row is preserved untouched so a bad mapping can be re-examined
  // without re-uploading the file (import spec §4).
  await run(
    `insert into import_rows (import_batch_id, row_number, raw, normalized, outcome,
                              match_rule, account_id, reject_reason, processed_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
    [
      batchId, rowNumber, JSON.stringify(raw), JSON.stringify(normalized), outcome,
      matchRule, accountId, rejectReasonText,
    ],
  );
}

export function formatImportReport(report: ImportReport): string {
  const lines: string[] = [];
  lines.push(`Import: ${report.sourceName}`);
  if (report.importBatchId) lines.push(`  batch          ${report.importBatchId}`);
  lines.push(`  rows           ${report.rows}`);
  lines.push(`  new accounts   ${report.created}`);
  lines.push(`  matched        ${report.matched}`);
  lines.push(`  rejected       ${report.rejected}`);
  lines.push(`  suppressed     ${report.suppressed}`);
  lines.push('');
  lines.push('  Column mapping:');
  for (const [field, column] of Object.entries(report.columnMap)) {
    lines.push(`    ${field.padEnd(20)} <- "${column}"`);
  }
  if (report.unmappedHeaders.length > 0) {
    lines.push(`    (kept as raw only: ${report.unmappedHeaders.join(', ')})`);
  }
  lines.push('');
  lines.push('  Match rules:');
  for (const [rule, count] of Object.entries(report.matchRules)) {
    lines.push(`    ${rule.padEnd(32)} ${count}`);
  }
  lines.push('');
  lines.push('  List quality:');
  const q = report.quality;
  const usable = report.rows - report.rejected;
  const pct = (n: number): string => (usable > 0 ? `${Math.round((n / usable) * 100)}%` : 'n/a');
  lines.push(`    unique accounts               ${q.uniqueAccounts}`);
  lines.push(`    duplicate rate                ${q.duplicatePercent}%`);
  lines.push(`    website present               ${q.websitesResolved} (${pct(q.websitesResolved)})`);
  lines.push(`    phone present                 ${q.phonesResolved} (${pct(q.phonesResolved)})`);
  lines.push(`    email present                 ${q.emailsResolved} (${pct(q.emailsResolved)})`);
  lines.push(`    named contact present         ${q.namedContacts} (${pct(q.namedContacts)})`);
  lines.push(`    vertical resolved             ${q.verticalMatched} (${pct(q.verticalMatched)})`);
  if (q.verticalUnknown > 0) {
    lines.push(`    vertical hint not loaded      ${q.verticalUnknown} (kept as raw industry)`);
  }

  if (report.rejections.length > 0) {
    lines.push('');
    lines.push('  Rejected rows:');
    for (const rejection of report.rejections.slice(0, 15)) {
      lines.push(`    line ${String(rejection.line).padStart(5)}  ${rejection.company ?? '(no company)'} — ${rejection.reason}`);
    }
    if (report.rejections.length > 15) {
      lines.push(`    …and ${report.rejections.length - 15} more`);
    }
  }
  lines.push('');
  lines.push('  No outreach was started. Imported accounts enter shared inventory as unclaimed.');
  return lines.join('\n');
}

export { normalizePhone, normalizeEmail, classifyEmail };
