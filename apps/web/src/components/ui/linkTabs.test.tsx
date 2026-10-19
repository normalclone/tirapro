import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { LinkTabs } from './LinkTabs';

const items = [
  { to: '/connect/integrations/telegram', label: 'Telegram' },
  { to: '/connect/integrations/digest', label: 'Báo cáo định kỳ', title: 'Gửi theo lịch' },
];
const html = (location: string) =>
  renderToStaticMarkup(
    <StaticRouter location={location}>
      <LinkTabs ariaLabel="Mục tích hợp" items={items} />
    </StaticRouter>,
  );

describe('LinkTabs — tab theo route', () => {
  it('nav có tên, mỗi mục là link (không phải role=tab), cùng kiểu gạch chân với Tabs', () => {
    const out = html('/connect/integrations/telegram');
    expect(out).toMatch(/<nav [^>]*aria-label="Mục tích hợp"/);
    expect(out).toMatch(/<a [^>]*href="\/connect\/integrations\/digest"/);
    expect(out).not.toContain('role="tab"');
    expect(out).toContain('border-b-2');
  });
  it('chỉ mục khớp đường dẫn có aria-current="page" và kiểu đang chọn', () => {
    const out = html('/connect/integrations/digest');
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-current="page"[^>]*>Báo cáo định kỳ<|>Báo cáo định kỳ<\/a>/);
    expect(out).toMatch(/<a [^>]*aria-current="page"[^>]*href="\/connect\/integrations\/digest"/);
  });
  it('giữ title để giải nghĩa, có mờ mép khi cuộn ngang', () => {
    const out = html('/connect/integrations/telegram');
    expect(out).toContain('title="Gửi theo lịch"');
    expect(out).toContain('scroll-fade-x');
  });
});
