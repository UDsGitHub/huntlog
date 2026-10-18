import { BOM, neutralizeFormula, parseCsv, restoreFormulaText, toCsv } from './csv';

const cells = (text: string) => {
  const result = parseCsv(text);
  if ('error' in result) throw new Error(result.error);
  return result.rows.map((row) => row.cells);
};

describe('toCsv', () => {
  it('quotes only what needs it, doubling quotes, with CRLF lines', () => {
    expect(
      toCsv([
        ['plain', 'a,b', 'say "hi"', 'two\nlines', ''],
        ['x', 'y'],
      ]),
    ).toBe('plain,"a,b","say ""hi""","two\nlines",\r\nx,y\r\n');
  });
});

describe('parseCsv', () => {
  it('reads what toCsv writes', () => {
    const rows = [
      ['Company', 'Notes'],
      ['Acme, Inc.', 'Line one\r\nLine "two"'],
      ['', 'ends with comma,'],
    ];
    expect(cells(toCsv(rows))).toEqual(rows);
  });

  it.each([
    ['LF', 'a,b\nc,d\n'],
    ['CR', 'a,b\rc,d\r'],
    ['no final line end', 'a,b\r\nc,d'],
    ['a byte-order mark', `${BOM}a,b\r\nc,d\r\n`],
    ['blank lines', 'a,b\r\n\r\n\nc,d\r\n\r\n'],
  ])('takes %s', (_label, text) => {
    expect(cells(text)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps empty cells and ragged rows as they are', () => {
    expect(cells(',\r\na\r\na,b,c\r\n')).toEqual([['', ''], ['a'], ['a', 'b', 'c']]);
  });

  it('keeps a quote inside an unquoted cell', () => {
    expect(cells('5" screen,x\r\n')).toEqual([['5" screen', 'x']]);
  });

  it('numbers rows by the line they start on, counting line breaks inside quotes', () => {
    const result = parseCsv('h\r\n"a\r\nb"\r\n\r\nc\r\n');
    expect('rows' in result && result.rows.map((row) => row.line)).toEqual([1, 2, 5]);
  });

  it('opens quotes only at the start of a cell', () => {
    // Bad CSV is read as it is, never swallowing the lines after it.
    expect(cells('"a" "b",c\r\nd,e\r\n')).toEqual([
      ['a "b"', 'c'],
      ['d', 'e'],
    ]);
    expect(cells('"",x\r\n""x",y\r\n')).toEqual([
      ['', 'x'],
      ['x"', 'y'],
    ]);
  });

  it('fails for a quote that never closes', () => {
    expect(parseCsv('a\r\n"b,c\r\nd')).toEqual({
      error: 'A quoted value starting on line 2 never ends.',
    });
  });

  it('reads an empty file as no rows', () => {
    expect(cells('')).toEqual([]);
    expect(cells(BOM)).toEqual([]);
  });
});

describe('formulas', () => {
  it.each(['=SUM(A1)', '+1', '-5 years', '@cmd', '\tx', '\rx', '  =HYPERLINK("x")', '＝1', '＋1'])(
    'neutralizes %j and restores it',
    (value) => {
      expect(neutralizeFormula(value)).toBe(`'${value}`);
      expect(restoreFormulaText(neutralizeFormula(value))).toBe(value);
    },
  );

  it.each(["'quoted", "'- follow up", "''"])('keeps %j as it was across a round trip', (value) => {
    expect(neutralizeFormula(value)).toBe(`'${value}`);
    expect(restoreFormulaText(neutralizeFormula(value))).toBe(value);
  });

  it.each(['Acme', '', '5=5', 'a -b'])('leaves %j alone', (value) => {
    expect(neutralizeFormula(value)).toBe(value);
    expect(restoreFormulaText(value)).toBe(value);
  });
});
