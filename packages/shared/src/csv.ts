/** Tiện ích CSV dùng chung (BOM UTF-8 cho Excel, chống CSV-injection). */
export const CSV_BOM = '﻿';

export type CsvValue = string | number | boolean | Date | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

const DANGEROUS_START = /^[=+\-@\t\r]/;

export function csvCell(v: CsvValue, delimiter = ','): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === 'boolean') s = v ? 'Có' : 'Không';
  else s = String(v);
  // OWASP: ô chuỗi bắt đầu bằng = + - @ TAB CR có thể bị Excel hiểu là công thức.
  if (typeof v === 'string' && DANGEROUS_START.test(s)) s = `'${s}`;
  return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(
  rows: T[],
  columns: CsvColumn<T>[],
  opts: { delimiter?: ',' | ';'; bom?: boolean } = {},
): string {
  const d = opts.delimiter ?? ',';
  const lines = [columns.map((c) => csvCell(c.header, d)).join(d)];
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.value(r), d)).join(d));
  return (opts.bom === false ? '' : CSV_BOM) + lines.join('\r\n') + '\r\n';
}
