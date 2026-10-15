import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { keys } from '@/lib/queryKeys';
import { MarkdownView } from './MarkdownView';

const html = (text: string, onToggleTask?: () => void, client = new QueryClient()) =>
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MarkdownView text={text} onToggleTask={onToggleTask} />
    </QueryClientProvider>,
  );

describe('MarkdownView — an toàn đầu ra (không dangerouslySetInnerHTML)', () => {
  it('HTML thô hiển thị thành chữ, không thành thẻ', () => {
    const out = html('<script>alert(1)</script> <img src=x onerror=alert(1)> <b>x</b>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('liên kết nguy hiểm/protocol-relative không thành href; liên kết tốt có noopener', () => {
    const out = html(
      '[a](javascript:alert(1)) [b](data:text/html,x) [c](//evil.com) [d](/\\evil.com) [ok](https://example.com)',
    );
    expect(out).not.toMatch(/href="javascript/i);
    expect(out).not.toMatch(/href="data:/i);
    expect(out).not.toContain('href="//evil.com');
    expect(out).not.toContain('evil.com"');
    const ok = /<a [^>]*href="https:\/\/example.com"[^>]*>/.exec(out)?.[0] ?? '';
    expect(ok).toContain('rel="noopener noreferrer nofollow"');
  });

  it('ảnh: chặn data:text/html và //host, giữ chữ thay thế', () => {
    const out = html('![x](data:text/html,x) ![y](//evil.com/p.png) ![z](https://ok.io/p.png)');
    expect(out).not.toContain('data:text/html');
    expect(out).not.toContain('//evil.com');
    expect(out).toContain('src="https://ok.io/p.png"');
  });

  it('ô tick: chỉ đọc khi không có onToggleTask, bấm được khi có', () => {
    const md = '- [ ] a\n- [x] b';
    expect(html(md)).toContain('disabled=""');
    expect(html(md, () => undefined)).not.toContain('disabled=""');
  });

  it('chip mention hiển thị chữ @Tên (không HTML), thẻ giả trong tên bị escape', () => {
    const out = html('cc @[<i>Admin</i>](user:u1)');
    expect(out).not.toContain('<i>');
  });

  it('chip mention hiển thị tên THẬT theo id, không tin tên giả trong token', () => {
    const client = new QueryClient();
    client.setQueryData(keys.users.workspace, [{ id: 'u1', displayName: 'Trang (Tester)' }]);
    const out = html('cc @[Admin](user:u1) và @[Lạ](user:u9)', undefined, client);
    expect(out).toContain('@Trang (Tester)');
    expect(out).not.toContain('@Admin');
    expect(out).toContain('@Lạ'); // không tìm thấy → tên trong token
  });
});
