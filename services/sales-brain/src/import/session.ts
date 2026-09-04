import { createHash } from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import { parseCsv, detectDelimiter } from './csv.js';
import { applyColumnMap, inferColumnMap, verticalHintFor, type ColumnMap, type MappedRow } from './mapping.js';
import { resolveAccountIdentity } from '../domain/accounts.js';
import { importCsvContent, type ImportReport } from './importer.js';
import { normalizeEmail, normalizePhone } from '../domain/normalize.js';

/**
 * Import wizard sessions.
 * Authority: CLAUDE-EXTERNAL-BLOCKERS-CURRENT.md §2,
 * YAD-SALES-CRM-UI-MOCKUPS-CURRENT.md §22.
 *
 * Upload → map → preview → confirm. Nothing touches canonical Accounts until the
 * operator confirms, and confirming never starts outreach.
 */

export interface SessionSummary {
  importSessionId: string;
  sourceName: string;
  fileName: string | null;
  rowCount: number;
  headers: string[];
  columnMap: ColumnMap;
  unmappedHeaders: string[];
  status: string;
  preview: ImportPreview | null;
  createdAt: Date;
}

export interface PreviewRow {
  line: number;
  company: string | null;
  phone: string | null;
  email: string | null;
  geography: string | null;
  contact: string | null;
  /** What would happen if this import were confirmed. */
  outcome: 'CREATE' | 'MERGE' | 'REJECT' | 'SUPPRESSED' | 'OWNED_BY_OTHER';
  detail: string | null;
  matchedAccount?: { accountId: string; name: string; owner: string | null } | null;
}

export interface ImportPreview {
  rows: PreviewRow[];
  totals: {
    rows: number; create: number; merge: number; reject: number;
    suppressed: number; ownedByOther: number;
  };
  qualityNotes: string[];
}

const MAX_PREVIEW_ROWS = 200;

export async function createSession(input: {
  content: string; fileName: string; sourceName: string;
  sourceKind?: string; createdBy: string;
}): Promise<SessionSummary> {
  const parsed = parseCsv(input.content, detectDelimiter(input.content));
  if (parsed.headers.length === 0) {
    throw new Error('That file has no header row, so its columns cannot be identified.');
  }
  const columnMap = inferColumnMap(parsed.headers);
  const sha256 = createHash('sha256').update(input.content).digest('hex');

  // Refuse a file already imported, before the operator invests in mapping it.
  const existing = await query<{ source_name: string }>(
    'select source_name from import_batches where file_sha256 = $1', [sha256]);
  if (existing.rows[0]) {
    throw new Error(
      `This exact file was already imported as "${existing.rows[0].source_name}". Nothing was uploaded again.`,
    );
  }

  const { rows } = await query<{ import_session_id: string; created_at: Date }>(
    `insert into import_sessions (created_by, source_kind, source_name, file_name, file_sha256,
                                  row_count, headers, raw_rows, column_map, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'MAPPED')
     returning import_session_id, created_at`,
    [
      input.createdBy, input.sourceKind ?? 'csv', input.sourceName, input.fileName, sha256,
      parsed.rows.length, parsed.headers, JSON.stringify(parsed.rows), JSON.stringify(columnMap),
    ],
  );

  const mapped = new Set(Object.values(columnMap));
  return {
    importSessionId: rows[0]!.import_session_id,
    sourceName: input.sourceName,
    fileName: input.fileName,
    rowCount: parsed.rows.length,
    headers: parsed.headers,
    columnMap,
    unmappedHeaders: parsed.headers.filter((header) => !mapped.has(header)),
    status: 'MAPPED',
    preview: null,
    createdAt: rows[0]!.created_at,
  };
}

export async function getSession(sessionId: string, userId: string): Promise<{
  summary: SessionSummary; rawRows: Record<string, string>[];
} | null> {
  const { rows } = await query<{
    import_session_id: string; source_name: string; file_name: string | null;
    row_count: number; headers: string[]; raw_rows: Record<string, string>[] | null;
    column_map: ColumnMap; status: string; preview: ImportPreview | null;
    created_at: Date; created_by: string; default_vertical_profile_id: string | null;
  }>(
    'select * from import_sessions where import_session_id = $1', [sessionId]);
  const session = rows[0];
  if (!session) return null;
  // An import session belongs to the person who started it.
  if (session.created_by !== userId) return null;

  const mapped = new Set(Object.values(session.column_map ?? {}));
  return {
    summary: {
      importSessionId: session.import_session_id,
      sourceName: session.source_name,
      fileName: session.file_name,
      rowCount: session.row_count,
      headers: session.headers,
      columnMap: session.column_map ?? {},
      unmappedHeaders: (session.headers ?? []).filter((header) => !mapped.has(header)),
      status: session.status,
      preview: session.preview,
      createdAt: session.created_at,
    },
    rawRows: session.raw_rows ?? [],
  };
}

export async function setColumnMap(
  sessionId: string, userId: string, columnMap: ColumnMap, defaultVertical: string | null,
): Promise<void> {
  await query(
    `update import_sessions set column_map = $3, default_vertical_profile_id = $4, status = 'MAPPED'
      where import_session_id = $1 and created_by = $2`,
    [sessionId, userId, JSON.stringify(columnMap), defaultVertical],
  );
}

/**
 * Dry-run the import against canonical state so the operator sees exactly what
 * confirming would do — including which rows would merge into an existing Account,
 * which are suppressed, and which belong to another rep.
 */
export async function buildPreview(sessionId: string, userId: string): Promise<ImportPreview | null> {
  const loaded = await getSession(sessionId, userId);
  if (!loaded) return null;
  const { summary, rawRows } = loaded;

  const knownVerticals = new Set(
    (await query<{ vertical_profile_id: string }>(
      'select vertical_profile_id from vertical_profiles where is_active')).rows
      .map((row) => row.vertical_profile_id),
  );

  const rows: PreviewRow[] = [];
  const totals = { rows: rawRows.length, create: 0, merge: 0, reject: 0, suppressed: 0, ownedByOther: 0 };
  let missingPhone = 0;
  let missingEmail = 0;
  let missingWebsite = 0;

  await withTransaction(async (client) => {
    for (let index = 0; index < Math.min(rawRows.length, MAX_PREVIEW_ROWS); index += 1) {
      const raw = rawRows[index]!;
      const mapped = applyColumnMap(raw, summary.columnMap);

      const reject = rejectReason(mapped);
      if (reject) {
        rows.push({
          line: index + 2, company: mapped.company, phone: null, email: null,
          geography: null, contact: null, outcome: 'REJECT', detail: reject,
        });
        totals.reject += 1;
        continue;
      }

      if (!mapped.phone && !mapped.directPhone) missingPhone += 1;
      if (!mapped.email) missingEmail += 1;
      if (!mapped.domain) missingWebsite += 1;

      const hinted = verticalHintFor(mapped.industry);
      const existing = await resolveAccountIdentity(client, {
        canonicalName: mapped.company ?? mapped.domain!,
        website: mapped.domain, phone: mapped.phone,
        city: mapped.city, state: mapped.state, postalCode: mapped.postalCode,
        verticalProfileId: hinted && knownVerticals.has(hinted) ? hinted : null,
      });

      const base = {
        line: index + 2,
        company: mapped.company,
        phone: normalizePhone(mapped.phone ?? mapped.directPhone),
        email: normalizeEmail(mapped.email),
        geography: [mapped.city, mapped.state].filter(Boolean).join(', ') || null,
        contact: mapped.contactName,
      };

      if (!existing) {
        rows.push({ ...base, outcome: 'CREATE', detail: 'New account' });
        totals.create += 1;
        continue;
      }

      const { rows: accountRows } = await client.query<{
        canonical_name: string; is_suppressed: boolean; owner: string | null;
      }>(
        `select a.canonical_name, a.is_suppressed, u.display_name as owner
           from accounts a left join users u on u.user_id = a.current_owner_user_id
          where a.account_id = $1`,
        [existing.accountId],
      );
      const account = accountRows[0]!;

      if (account.is_suppressed) {
        rows.push({
          ...base, outcome: 'SUPPRESSED',
          detail: 'Matches a suppressed company — the import will not make it contactable',
          matchedAccount: { accountId: existing.accountId, name: account.canonical_name, owner: null },
        });
        totals.suppressed += 1;
        continue;
      }
      if (account.owner) {
        rows.push({
          ...base, outcome: 'OWNED_BY_OTHER',
          detail: `Merges into an account already owned by ${account.owner}`,
          matchedAccount: { accountId: existing.accountId, name: account.canonical_name, owner: account.owner },
        });
        totals.ownedByOther += 1;
        continue;
      }
      rows.push({
        ...base, outcome: 'MERGE',
        detail: `Merges into "${account.canonical_name}" on ${existing.matchRule.replace(/_/g, ' ')}`,
        matchedAccount: { accountId: existing.accountId, name: account.canonical_name, owner: null },
      });
      totals.merge += 1;
    }
  });

  const usable = totals.rows - totals.reject;
  const qualityNotes: string[] = [];
  if (usable > 0) {
    const pct = (n: number): number => Math.round((n / usable) * 100);
    if (missingPhone > 0) qualityNotes.push(`${pct(missingPhone)}% of rows have no phone number.`);
    if (missingEmail > 0) qualityNotes.push(`${pct(missingEmail)}% have no email address.`);
    if (missingWebsite > 0) qualityNotes.push(`${pct(missingWebsite)}% have no website.`);
  }
  if (totals.suppressed > 0) {
    qualityNotes.push(
      `${totals.suppressed} row(s) match companies that asked not to be contacted. `
      + 'Importing will not make them contactable.');
  }
  if (rawRows.length > MAX_PREVIEW_ROWS) {
    qualityNotes.push(
      `Previewing the first ${MAX_PREVIEW_ROWS} of ${rawRows.length} rows. All rows import on confirm.`);
  }

  const preview: ImportPreview = { rows, totals, qualityNotes };
  await query(
    `update import_sessions set preview = $2, status = 'PREVIEWED' where import_session_id = $1`,
    [sessionId, JSON.stringify(preview)],
  );
  return preview;
}

function rejectReason(row: MappedRow): string | null {
  if (!row.company && !row.domain) return 'No company name or website';
  if (row.company && row.company.trim().length < 2) return 'Company name too short to identify a business';
  if (!row.phone && !row.directPhone && !row.email && !row.domain) {
    return 'No website, phone or email — nothing to research or contact';
  }
  return null;
}

/** Commits the import through the same pipeline a CLI import uses. */
export async function confirmSession(
  sessionId: string, userId: string,
): Promise<{ ok: boolean; report?: ImportReport; message?: string }> {
  const { rows } = await query<{
    raw_rows: Record<string, string>[] | null; headers: string[]; column_map: ColumnMap;
    source_name: string; source_kind: string; file_name: string | null; file_sha256: string;
    default_vertical_profile_id: string | null; status: string; created_by: string;
  }>('select * from import_sessions where import_session_id = $1', [sessionId]);
  const session = rows[0];
  if (!session) return { ok: false, message: 'That import session no longer exists.' };
  if (session.created_by !== userId) return { ok: false, message: 'That import session belongs to someone else.' };
  if (session.status === 'CONFIRMED') return { ok: false, message: 'This import has already been confirmed.' };
  if (!session.raw_rows) return { ok: false, message: 'The uploaded rows are no longer available.' };

  // Rebuild a CSV from the stored rows so the confirm path is the same importer the
  // CLI uses — one code path, one set of guarantees.
  const csv = toCsv(session.headers, session.raw_rows);
  const report = await importCsvContent(
    csv,
    {
      sourceName: session.source_name,
      sourceKind: session.source_kind as never,
      defaultVerticalProfileId: session.default_vertical_profile_id,
      importedBy: userId,
      columnMap: session.column_map,
    },
    { fileName: session.file_name ?? undefined, sha256: session.file_sha256 },
  );

  await query(
    `update import_sessions set status = 'CONFIRMED', import_batch_id = $2, raw_rows = null
      where import_session_id = $1`,
    [sessionId, report.importBatchId],
  );
  if (report.importBatchId) {
    await query('update import_batches set import_session_id = $2 where import_batch_id = $1',
      [report.importBatchId, sessionId]);
  }
  return { ok: true, report };
}

function toCsv(headers: string[], rows: Record<string, string>[]): string {
  const escape = (value: string): string =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header] ?? '')).join(','));
  }
  return lines.join('\n');
}

export async function listImportHistory(): Promise<any[]> {
  const { rows } = await query(
    `select b.import_batch_id, b.source_name, b.source_kind, b.file_name, b.row_count,
            b.accounts_created, b.accounts_matched, b.rows_rejected, b.rows_suppressed,
            b.status, b.created_at, u.display_name as imported_by
       from import_batches b left join users u on u.user_id = b.created_by
      order by b.created_at desc limit 50`);
  return rows;
}

/** Drops abandoned uploads so an unconfirmed file does not linger. */
export async function expireStaleSessions(): Promise<number> {
  const { rowCount } = await query(
    `update import_sessions set status = 'EXPIRED', raw_rows = null
      where expires_at < now() and status not in ('CONFIRMED','CANCELLED','EXPIRED')`);
  return rowCount ?? 0;
}
