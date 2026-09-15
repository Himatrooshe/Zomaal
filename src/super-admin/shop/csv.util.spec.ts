import { parseCsv, toCsv } from './csv.util';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields with commas, newlines, and escaped quotes', () => {
    expect(parseCsv('name,desc\n"Box, large","Say ""hi""\nline two"')).toEqual([
      ['name', 'desc'],
      ['Box, large', 'Say "hi"\nline two'],
    ]);
  });

  it('handles CRLF, a UTF-8 BOM, and blank lines', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n\r\n,\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps empty cells', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });
});

describe('toCsv', () => {
  it('quotes cells that need it and round-trips through parseCsv', () => {
    const rows = [
      ['name', 'description'],
      ['Box, large', 'Say "hi"'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('neutralizes spreadsheet formula injection', () => {
    expect(toCsv([['=HYPERLINK("x")', '+1', '-2', '@SUM']])).toBe(
      `"'=HYPERLINK(""x"")",'+1,'-2,'@SUM`,
    );
  });

  it('renders null and undefined as empty cells', () => {
    expect(toCsv([[null, undefined, 0]])).toBe(',,0');
  });
});
