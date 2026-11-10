import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
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
    client.setQueryData(keys.users.search('', '', 200, true), [
      { id: 'u1', displayName: 'Trang (Tester)' },
    ]);
    const out = html('cc @[Admin](user:u1) và @[Lạ](user:u9)', undefined, client);
    expect(out).toContain('@Trang (Tester)');
    expect(out).not.toContain('@Admin');
    expect(out).toContain('@Lạ'); // không tìm thấy → tên trong token
  });

  it('ảnh attachment:ID dựng nút phóng to (không <img src=attachment:…>); id lạ không thành ảnh', () => {
    const out = html('![bằng chứng](attachment:cmabc123)');
    expect(out).toContain('aria-label="Xem ảnh bằng chứng"');
    expect(out).not.toContain('src="attachment:');
    const bad = html('![x](attachment:../../etc/passwd) ![y](attachment:a b)');
    expect(bad).not.toContain('Xem ảnh');
    expect(bad).not.toContain('<img');
  });

  it('ảnh blob đã có trong cache query hiển thị đúng và alt không phá HTML', () => {
    const client = new QueryClient();
    client.setQueryData(keys.attachments.blob('cm1'), 'blob:http://x/abc');
    const out = html('![a"><script>](attachment:cm1)', undefined, client);
    expect(out).not.toContain('<script');
    expect(out).toContain('src="blob:http://x/abc"'); // ảnh thật được dựng từ cache
  });
});

describe('MarkdownView — chip công việc (issueRefs)', () => {
  const ref = {
    id: 'i1',
    key: 'DEMO-STORY-3',
    summary: 'Đăng nhập bằng email',
    typeName: 'Story',
    statusName: 'Đang làm',
    statusCategory: 'IN_PROGRESS' as const,
  };
  const withRefs = (text: string, refs?: Record<string, typeof ref>) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <MarkdownView text={text} issueRefs={refs} />
        </QueryClientProvider>
      </MemoryRouter>,
    );

  it('mã đã xác nhận → liên kết /issue/:key; mã lạ (UTF-8) giữ là chữ', () => {
    const out = withRefs('Xem DEMO-STORY-3 và UTF-8', { 'DEMO-STORY-3': ref });
    expect(out).toContain('href="/issue/DEMO-STORY-3"');
    expect(out).toContain('Đăng nhập bằng email');
    expect(out).not.toContain('href="/issue/UTF-8"');
    expect(out).toContain('UTF-8');
  });

  it('không truyền issueRefs → mã là chữ thường; mã trong `code` không thành chip', () => {
    expect(withRefs('Xem DEMO-STORY-3')).not.toContain('href=');
    expect(withRefs('`DEMO-STORY-3`', { 'DEMO-STORY-3': ref })).not.toContain('href=');
  });
});

describe('MarkdownView — in nghiêng (logbug #9)', () => {
  it.each([
    '*in nghiêng*',
    '_in nghiêng_',
    'chữ *nghiêng có dấu ê* và thường',
    '**đậm** và *nghiêng*',
  ])('%s → thẻ em', (md) => {
    expect(html(md)).toContain('<em>');
  });
});

describe('MarkdownView — đậm + nghiêng kết hợp (TIRA-BUG-29)', () => {
  it.each(['***vừa đậm vừa nghiêng***', '**_vừa đậm vừa nghiêng_**', '_**vừa đậm vừa nghiêng**_'])(
    '%s → strong lồng em',
    (md) => {
      const out = html(md);
      expect(out).toMatch(/<strong[^>]*><em>vừa đậm vừa nghiêng<\/em><\/strong>/);
      expect(out).not.toContain('*');
      expect(out).not.toContain('_vừa');
    },
  );

  it('đậm thường và nghiêng thường vẫn hoạt động riêng lẻ', () => {
    expect(html('**chỉ đậm**')).toMatch(/<strong[^>]*>chỉ đậm<\/strong>/);
    expect(html('**chỉ đậm**')).not.toContain('<em>');
    expect(html('*chỉ nghiêng*')).toContain('<em>chỉ nghiêng</em>');
  });
});

describe('MarkdownView — mô tả dài không làm vỡ layout (logbug #12)', () => {
  it('khung bao cho phép ngắt chuỗi dài không dấu cách', () => {
    expect(html('x'.repeat(500))).toContain('[overflow-wrap:anywhere]');
  });
});

describe('MarkdownView — link dán trơn bấm được', () => {
  it('URL trơn thành thẻ a mở tab mới', () => {
    const out = html('Ảnh lỗi: https://prnt.sc/OuyzVTUyrOS3 xem giúp');
    const a =
      /<a [^>]*href="https:\/\/prnt.sc\/OuyzVTUyrOS3"[^>]*>https:\/\/prnt.sc\/OuyzVTUyrOS3<\/a>/.exec(
        out,
      )?.[0] ?? '';
    expect(a).toContain('target="_blank"');
    expect(a).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain(' xem giúp');
  });

  it('bỏ dấu câu cuối khỏi link; giữ ngoặc cân bằng', () => {
    const out = html('Xem https://a.io/x. Và (https://b.io/y), https://w.org/A_(b)!');
    expect(out).toContain('href="https://a.io/x"');
    expect(out).toContain('href="https://b.io/y"');
    expect(out).toContain('href="https://w.org/A_(b)"');
    expect(out).toContain('</a>. Và (');
  });

  it('dấu _ trong URL không biến thành chữ nghiêng', () => {
    const out = html('https://x.io/a_b_c');
    expect(out).toContain('href="https://x.io/a_b_c"');
    expect(out).not.toContain('<em>');
  });

  it('URL trong [chữ](url) và trong `code` không bị xử lý lại', () => {
    const out = html('[trang](https://a.io) `https://c.io`');
    expect(out.match(/<a /g)?.length).toBe(1);
    expect(out).toContain('>trang</a>');
    expect(out).toContain('<code');
  });

  it('chỉ http/https: javascript: không thành link', () => {
    const out = html('javascript:alert(1)');
    expect(out).not.toContain('<a ');
  });
});
