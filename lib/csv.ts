/**
 * CSV as RFC 4180 has it: fields separated by commas, a field holding a comma, a quote or a line
 * break wrapped in quotes (a quote inside doubled), lines ending in CRLF. Written by hand: no
 * library ships in the extension (spec §9).
 */

/**
 * What a spreadsheet may run as a formula: `=`, `+`, `-` or `@` (or their full-width forms),
 * even after leading spaces, and a cell starting with a tab or carriage return.
 */
const FORMULA_START = /^(\s*[=+\-@＝＋－＠]|[\t\r])/;

/**
 * Guards a cell a spreadsheet would run as a formula with a leading `'`, which spreadsheets show
 * as text (spec §6). A cell that already starts with `'` gets one more, so `restoreFormulaText`
 * can always take exactly one off and an export reads back as it was.
 */
export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) || value.startsWith("'") ? `'${value}` : value;
}

/** Undoes `neutralizeFormula`: the `'` it added is dropped. */
export function restoreFormulaText(value: string): string {
  const rest = value.slice(1);
  return value.startsWith("'") && (FORMULA_START.test(rest) || rest.startsWith("'")) ? rest : value;
}

function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Rows as CSV text, each line ending in CRLF. Cells are written as given. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => `${row.map(cell).join(',')}\r\n`).join('');
}

/** A UTF-8 byte-order mark: without it, Excel reads the file in the system's code page. */
export const BOM = '\uFEFF';

/**
 * Reads CSV text into rows of cells. Takes CRLF, LF or CR line ends, a byte-order mark, quoted
 * cells with line breaks and doubled quotes, and a missing final line end. Blank lines are
 * skipped. Each row keeps the line it started on, for messages. Fails only for a quote that never
 * closes.
 */
export function parseCsv(
  text: string,
): { rows: { line: number; cells: string[] }[] } | { error: string } {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let value = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  // Whether anything was read on this row: a blank line has no cells.
  let started = false;
  // At the start of a cell: only there does a quote open a quoted value. After one closes, the
  // rest of the cell (bad CSV) is taken as it is, never reopening quotes over the next lines.
  let fresh = true;

  const endRow = () => {
    if (started) rows.push({ line: rowLine, cells: [...cells, value] });
    cells = [];
    value = '';
    started = false;
    fresh = true;
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          value += '"';
          i++;
        } else quoted = false;
      } else {
        if (char === '\n' || (char === '\r' && source[i + 1] !== '\n')) line++;
        value += char;
      }
      continue;
    }
    if (char === '"' && fresh) {
      quoted = true;
      started = true;
      fresh = false;
    } else if (char === ',') {
      cells.push(value);
      value = '';
      started = true;
      fresh = true;
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      value += char;
      started = true;
      fresh = false;
    }
  }
  if (quoted) return { error: `A quoted value starting on line ${rowLine} never ends.` };
  endRow();
  return { rows };
}
