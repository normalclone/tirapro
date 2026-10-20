import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { AiIssuePanel } from '@/features/ai/AiIssuePanel';

const page = readFileSync(join(__dirname, 'IssueDetailPage.tsx'), 'utf8');

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <StaticRouter location="/">{el}</StaticRouter>
    </QueryClientProvider>,
  );

describe('AiIssuePanel — vùng có tên, một h1 mỗi trang', () => {
  it('thẻ (cột phải): <section> có tên là h2 "Trợ lý AI", không phải h1', () => {
    const html = render(<AiIssuePanel issueId="i1" />);
    expect(html).toMatch(/<section[^>]*aria-labelledby="([^"]+)"/);
    const id = /aria-labelledby="([^"]+)"/.exec(html)![1]!;
    expect(html).toMatch(new RegExp(`<h2[^>]*id="${id}"[^>]*>[^<]*Trợ lý AI`));
    expect(html).not.toContain('<h1');
  });
  it('dạng "bare" (trong phần mở/thu đã có nhãn): không lặp tiêu đề, vẫn có nút Tóm tắt / Gợi ý bấm tay', () => {
    const html = render(<AiIssuePanel issueId="i1" variant="bare" />);
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('<section');
    expect(html).toContain('Tóm tắt');
    expect(html).toContain('Gợi ý ưu tiên &amp; điểm');
  });
  it('không tự chạy: không có lời gọi nào ở lần render đầu (chỉ nút)', () => {
    const src = readFileSync(join(__dirname, '../ai/AiIssuePanel.tsx'), 'utf8');
    expect(src).not.toMatch(/useEffect\([^)]*run\(/);
    expect(src).toMatch(/onClick=\{suggest\.run\}/);
  });
});

describe('IssueDetailPage — gắn trợ lý AI (RC25)', () => {
  it('chỉ hiện khi có quyền ai:use ở dự án (không đòi ISSUE_EDIT) VÀ người dùng đang bật AI; không bị ẩn khi dự án lưu trữ', () => {
    expect(page).toMatch(/useAi\(\(s\) => s\.enabled\)/);
    expect(page).toMatch(/useCan\([^)]*\)\('ai:use'\)/);
    expect(page).not.toMatch(/canAi[^\n]*issue:edit/);
    expect(page).not.toMatch(/useAuth\(\(s\) => s\.can\)/);
  });
  it('mọi chỗ gắn có key={issue.id} (kết quả/tóm tắt cũ không rò sang việc khác)', () => {
    const uses = page.match(/<AiIssuePanel[^>]*>/g) ?? [];
    expect(uses.length).toBe(2);
    for (const u of uses) expect(u).toContain('key={issue.id}');
  });
  it('trang chi tiết không có xem nhanh: không truyền onPeek (bấm thường điều hướng /issue/KEY)', () => {
    for (const u of page.match(/<AiIssuePanel[^>]*>/g) ?? []) expect(u).not.toContain('onPeek');
  });
  it('từ lg ở cột phải dưới thuộc tính; dưới lg là phần mở/thu "Trợ lý AI" nhớ theo người dùng, giữa mô tả và hoạt động', () => {
    expect(page).toMatch(/\{isDesktop && showAi/);
    expect(page).toMatch(/!isDesktop && showAi/);
    expect(page).toMatch(/title="Trợ lý AI"/);
    expect(page).toMatch(/keyFor=\{aiPanelKey\}/);
    const desc = page.indexOf('<IssueDescription issue={issue} />');
    const disclosure = page.indexOf('!isDesktop && showAi');
    const activity = page.indexOf('<ActivityTabs');
    expect(desc).toBeLessThan(disclosure);
    expect(disclosure).toBeLessThan(activity);
    const aside = page.indexOf('<aside');
    expect(aside).toBeGreaterThan(-1);
    expect(page.indexOf('{isDesktop && showAi')).toBeGreaterThan(aside);
  });
  it('knip.jsonc không còn che AiIssuePanel', () => {
    const knip = readFileSync(join(__dirname, '../../../../../knip.jsonc'), 'utf8');
    expect(knip).not.toContain('AiIssuePanel');
  });
});
