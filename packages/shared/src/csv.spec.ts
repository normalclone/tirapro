import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvCell, toCsv } from './csv';

describe('csvCell', () => {
  it('bọc dấu ngoặc kép khi có dấu phẩy/ngoặc kép/xuống dòng và nhân đôi ngoặc kép', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('nói "xin chào"')).toBe('"nói ""xin chào"""');
    expect(csvCell('dòng 1\ndòng 2')).toBe('"dòng 1\ndòng 2"');
  });
  it('chống CSV-injection cho chuỗi bắt đầu bằng = + - @', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvCell('+84 123')).toBe("'+84 123");
    expect(csvCell('@user')).toBe("'@user");
    expect(csvCell('-cmd')).toBe("'-cmd");
  });
  it('số âm kiểu number giữ nguyên; null/undefined → rỗng; boolean → Có/Không; Date → ISO', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(true)).toBe('Có');
    expect(csvCell(new Date('2026-10-15T00:00:00.000Z'))).toBe('2026-10-15T00:00:00.000Z');
  });
});

describe('toCsv', () => {
  const rows = [{ key: 'DEMO-BUG-1', title: 'Lỗi, nặng', pts: 3 }];
  const cols = [
    { header: 'Mã', value: (r: (typeof rows)[number]) => r.key },
    { header: 'Tiêu đề', value: (r: (typeof rows)[number]) => r.title },
    { header: 'Điểm', value: (r: (typeof rows)[number]) => r.pts },
  ];
  it('có BOM, header, CRLF, delimiter tuỳ chọn', () => {
    const csv = toCsv(rows, cols);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(1)).toBe('Mã,Tiêu đề,Điểm\r\nDEMO-BUG-1,"Lỗi, nặng",3\r\n');
    expect(toCsv(rows, cols, { delimiter: ';', bom: false })).toBe(
      'Mã;Tiêu đề;Điểm\r\nDEMO-BUG-1;Lỗi, nặng;3\r\n',
    );
  });
  it('rows rỗng vẫn có dòng header', () => {
    expect(toCsv([], cols, { bom: false })).toBe('Mã,Tiêu đề,Điểm\r\n');
  });
});
