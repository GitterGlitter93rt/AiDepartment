/**
 * Minimal server-side HTML rendering. No template engine: escaping by default in a
 * tagged template is the whole requirement, and a dependency here would be one more
 * thing to keep patched on an internal box.
 */

export class RawHtml {
  constructor(public readonly value: string) {}
  toString(): string { return this.value; }
}

/** Marks a string as already-safe HTML. Only ever call this on strings we generated. */
export function raw(value: string): RawHtml {
  return new RawHtml(value);
}

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof RawHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return escapeHtml(value);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): RawHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i += 1) {
    out += renderValue(values[i]) + (strings[i + 1] ?? '');
  }
  return new RawHtml(out);
}

/** Safe JSON for embedding in a <script> block. */
export function jsonScript(value: unknown): RawHtml {
  return raw(
    JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029'),
  );
}

export function classNames(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
