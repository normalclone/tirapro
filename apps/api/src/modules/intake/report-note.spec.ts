import { describe, expect, it } from 'vitest';
import { buildReportNote } from './report-note';

const base = { reporterName: 'Trang', at: new Date('2026-10-16T03:04:00Z') };

describe('buildReportNote', () => {
  it('giữ nguyên mô tả, thêm môi trường và ảnh/tệp', () => {
    const md = buildReportNote({
      ...base,
      description: 'Trên iPad Pro bị y hệt',
      environment: { os: 'iPadOS 17.5', browser: 'Safari 17' },
      attachments: [
        { id: 'a1', fileName: 'loi.png', mimeType: 'image/png' },
        { id: 'a2', fileName: 'log.txt', mimeType: 'text/plain' },
      ],
    });
    expect(md).toContain('Trang báo lại');
    expect(md).toContain('Trên iPad Pro bị y hệt');
    expect(md).toContain('**Môi trường:** Safari 17 · iPadOS 17.5');
    expect(md).toContain('![loi.png](attachment:a1)');
    expect(md).toContain('Tệp: log.txt');
    expect(md).not.toContain('attachment:a2');
  });

  it('không có nội dung vẫn ra ghi chú tối thiểu', () => {
    expect(
      buildReportNote({ ...base, description: null, environment: null, attachments: [] }),
    ).toContain('Trang báo lại');
  });

  it('dòng đầu in nghiêng, giờ theo múi Việt Nam (dd/MM/yyyy HH:mm)', () => {
    const md = buildReportNote({ ...base, attachments: [] });
    expect(md.split('\n')[0]).toBe('*Trang báo lại ngày 16/10/2026 10:04*');
  });

  it('chỉ ghi mức nghiêm trọng đề xuất khi được truyền (đã khác mức hiện tại)', () => {
    expect(buildReportNote({ ...base, severityName: 'Critical', attachments: [] })).toContain(
      '**Mức nghiêm trọng đề xuất:** Critical',
    );
    expect(buildReportNote({ ...base, attachments: [] })).not.toContain('nghiêm trọng');
  });
});
