/**
 * CSV parsing. RFC 4180 with the usual real-world tolerances: BOM, CRLF, quoted
 * fields containing commas and escaped quotes. Written here rather than pulled in
 * because a list import must not silently mangle a row and the failure modes are
 * worth owning.
 */

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  /** 1-indexed source line for each row, so an error can name the actual line. */
  lineNumbers: number[];
}

export function parseCsv(input: string, delimiter = ','): ParsedCsv {
  const text = input.replace(/^﻿/, '');
  const records: { fields: string[]; line: number }[] = [];

  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordStartLine = 1;
  let sawAnyChar = false;

  const endField = (): void => { record.push(field); field = ''; };
  const endRecord = (): void => {
    endField();
    // Skip blank lines rather than emitting an all-empty record.
    if (record.length > 1 || record[0] !== '') {
      records.push({ fields: record, line: recordStartLine });
    }
    record = [];
    recordStartLine = line + 1;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    sawAnyChar = true;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') { inQuotes = true; continue; }
    if (char === delimiter) { endField(); continue; }
    if (char === '\r') { if (text[i + 1] === '\n') i += 1; endRecord(); line += 1; continue; }
    if (char === '\n') { endRecord(); line += 1; continue; }
    field += char;
  }
  if (sawAnyChar && (field !== '' || record.length > 0)) endRecord();

  const first = records.shift();
  if (!first) return { headers: [], rows: [], lineNumbers: [] };

  const headers = first.fields.map((header) => header.trim());
  const rows: Record<string, string>[] = [];
  const lineNumbers: number[] = [];

  for (const entry of records) {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) row[header] = (entry.fields[index] ?? '').trim();
    });
    rows.push(row);
    lineNumbers.push(entry.line);
  }
  return { headers, rows, lineNumbers };
}

/** Guesses the delimiter from the header line. Tab and semicolon exports are common. */
export function detectDelimiter(input: string): string {
  const firstLine = input.replace(/^﻿/, '').split(/\r?\n/)[0] ?? '';
  const counts: [string, number][] = [
    [',', (firstLine.match(/,/g) ?? []).length],
    ['\t', (firstLine.match(/\t/g) ?? []).length],
    [';', (firstLine.match(/;/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ',';
}
