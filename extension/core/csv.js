// RFC 4180 CSV. No browser APIs.

const cell = value => {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheets treating place names as formulas
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = rows => rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
