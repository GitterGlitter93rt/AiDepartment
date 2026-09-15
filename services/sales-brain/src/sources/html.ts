/**
 * Reading tabular official records.
 *
 * Official registries print results in HTML tables, and flattening those to text
 * first loses the one thing a table is for: which cells belong to the same row.
 * `stripTags` puts every cell on its own line and collapses runs of spaces, so a
 * results table becomes an undifferentiated list of values -- fine for finding a
 * label/value pair, useless for reading three licences off a page without mixing
 * one licensee's name with another's licence number.
 *
 * So rows are read from the markup. No HTML parser dependency: these are government
 * tables, not arbitrary documents, and a regex over `<tr>`/`<td>` is both sufficient
 * and auditable.
 */

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

/** Every table row, as its list of cell texts. Header rows included. */
export function tableRows(html: string): string[][] {
  const rows: string[][] = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const cells: string[] = [];
    const cellPattern = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellPattern.exec(rowMatch[1]!)) !== null) {
      cells.push(decodeEntities(
        cellMatch[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/**
 * The contents of `<pre>` blocks, with their spacing intact.
 *
 * Some agencies print fixed-width reports inside `<pre>`, where column alignment is
 * the only thing separating one field from the next. `stripTags` collapses runs of
 * spaces, which destroys exactly that.
 */
export function preBlocks(html: string): string[] {
  const blocks: string[] = [];
  const pattern = /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    blocks.push(decodeEntities(match[1]!.replace(/<[^>]+>/g, '')));
  }
  return blocks;
}

/** A label/value lookup over a two-column table. */
export function labelledValue(rows: string[][], label: RegExp): string | null {
  for (const cells of rows) {
    if (cells.length >= 2 && label.test(cells[0]!)) {
      const value = cells[1]!.trim();
      if (value) return value;
    }
  }
  return null;
}
