/**
 * CSV output.
 *
 * Nothing in the product exports CSV yet. This exists because the import accepts
 * whatever a prospect list contains -- including values that begin `=`, `+`, `-` or
 * `@`, which a spreadsheet treats as a formula when the file is opened -- and the
 * place to make that safe is where the data leaves as CSV, not where it arrives.
 *
 * Neutralising on import would be the wrong end: it would corrupt a company whose
 * name genuinely starts with a plus sign, and it would leave the danger in place for
 * any value that reached the database another way. A prospect's data is stored as
 * they wrote it; the sink is what has to be careful.
 */

/** Characters a spreadsheet reads as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell: quoted per RFC 4180, and inert when opened in a spreadsheet.
 *
 * A leading formula character is prefixed with a single quote, which every major
 * spreadsheet treats as "this is text". The original value is still readable -- the
 * quote is not part of the cell's content once it is parsed -- so nothing is lost.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}

/** A whole file, with CRLF line endings as the format specifies. */
export function csvFile(headers: string[], rows: unknown[][]): string {
  return [csvRow(headers), ...rows.map(csvRow)].join('\r\n');
}
