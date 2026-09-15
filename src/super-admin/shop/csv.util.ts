// Minimal RFC 4180 CSV handling for the shop catalog import/export — quoted
// fields, escaped quotes (""), commas and newlines inside quotes, CRLF or LF
// line endings, and a leading UTF-8 BOM (Excel adds one). No dependency:
// the format is small and fixed.

export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully blank lines (trailing newline, empty rows from spreadsheets).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const cell =
            value === null || value === undefined ? '' : String(value);
          // Neutralize spreadsheet formula injection (=, +, -, @ leading a
          // cell executes in Excel/Sheets when the export is opened).
          const safe = /^[=+\-@]/.test(cell) ? `'${cell}` : cell;
          return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
        })
        .join(','),
    )
    .join('\r\n');
}
