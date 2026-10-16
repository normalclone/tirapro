import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { UsedByLine } from './WorkflowSettingsPage';

const html = (
  usedBy: { id: string; key: string; name: string; deleted: boolean }[],
  hidden?: number,
) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <UsedByLine usedBy={usedBy} hiddenCount={hidden} />
    </MemoryRouter>,
  );

describe('UsedByLine — dự án riêng tư không lộ khoá/tên (P15)', () => {
  it('chỉ có dự án riêng tư: "Đang dùng bởi 1 dự án bạn không xem được", không có khoá nào', () => {
    const out = html([], 1);
    expect(out).toContain('Đang dùng bởi');
    expect(out).toContain('1 dự án bạn không xem được');
    expect(out).not.toContain('<a');
  });

  it('có dự án thấy được + riêng tư: liệt kê dự án thấy, cộng "+N dự án bạn không xem được"', () => {
    const out = html([{ id: 'p1', key: 'WM', name: 'Website', deleted: false }], 2);
    expect(out).toContain('WM');
    expect(out).toContain('+2 dự án bạn không xem được');
  });

  it('hiddenCount = 0/không có: không nhắc dự án ẩn', () => {
    expect(html([{ id: 'p1', key: 'WM', name: 'Website', deleted: false }])).not.toContain(
      'không xem được',
    );
  });
});
