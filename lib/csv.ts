/**
 * CSV as RFC 4180 has it: fields separated by commas, a field holding a comma, a quote or a line
 * break wrapped in quotes (a quote inside doubled), lines ending in CRLF. Written by hand: no
 * library ships in the extension (spec §9).
 */

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * A spreadsheet runs a cell that starts with `=`, `+`, `-` or `@` (or a tab or carriage return)
 * as a formula, so such a cell gets a leading `'`, which spreadsheets show as text (spec §6). An
 * import removes it again (`restoreFormulaText`).
 */
export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** Undoes `neutralizeFormula`: a `'` before a formula character is dropped. */
export function restoreFormulaText(value: string): string {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Rows as CSV text, each line ending in CRLF. Cells are written as given. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => `${row.map(cell).join(',')}\r\n`).join('');
}

/** A UTF-8 byte-order mark: without it, Excel reads the file in the system's code page. */
export const BOM = '﻿';

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

  const endRow = () => {
    if (started) rows.push({ line: rowLine, cells: [...cells, value] });
    cells = [];
    value = '';
    started = false;
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
    if (char === '"' && value === '') {
      quoted = true;
      started = true;
    } else if (char === ',') {
      cells.push(value);
      value = '';
      started = true;
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      value += char;
      started = true;
    }
  }
  if (quoted) return { error: `A quoted value starting on line ${rowLine} never ends.` };
  endRow();
  return { rows };
}
