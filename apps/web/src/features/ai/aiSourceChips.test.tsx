import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AiSourceChips } from './AiSourceChips';
import { SuggestProgress } from './AiIssuePanel';

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(<StaticRouter location="/">{el}</StaticRouter>);

describe('AiSourceChips', () => {
  const html = render(
    <AiSourceChips
      sources={[
        { issueId: 'a', key: 'TP-5', summary: 'Đăng nhập lỗi' },
        { issueId: 'b', key: 'TP-2', summary: 'Giỏ hàng mất sản phẩm' },
      ]}
      onPeek={() => undefined}
    />,
  );
  it('danh sách có nhãn; mỗi chip là link thật tới /issue/KEY với tên = "[n] KEY — tiêu đề"', () => {
    expect(html).toContain('<ol');
    expect(html).toContain('aria-label="Nguồn tham khảo"');
    expect(html).toContain('href="/issue/TP-5"');
    expect(html).toContain('href="/issue/TP-2"');
    expect(html).toContain('[1] TP-5 — Đăng nhập lỗi');
    expect(html).toContain('[2] TP-2 — Giỏ hàng mất sản phẩm');
    expect(html).not.toMatch(/aria-label="\[1\]/); // tên là chính nội dung chữ, không có aria-label lệch với chữ nhìn thấy
  });
  it('không có nguồn → không vẽ gì (không để khung trống)', () => {
    expect(render(<AiSourceChips sources={[]} onPeek={undefined} />)).toBe('');
    expect(render(<AiSourceChips sources={undefined} onPeek={undefined} />)).toBe('');
  });
  it('cảm ứng: link cao ≥ 44px (mở vùng bấm dọc) và có focus ring', () => {
    expect(html).toContain('[@media(pointer:coarse)]:min-h-11');
    expect(html).toContain('focus-visible:ring-2');
  });
});

describe('SuggestProgress — "Đang phân tích…" + Huỷ', () => {
  const html = render(<SuggestProgress onCancel={() => undefined} />);
  it('vùng trạng thái đọc được và nút Huỷ là <button> thật (không disabled → focus được)', () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('Đang phân tích…');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Huỷ<\/button>/);
    expect(html).not.toMatch(/<button[^>]*\sdisabled(=|\s|>)/);
  });
  it('nút Huỷ nói rõ yêu cầu đã gửi vẫn có thể tính hạn mức', () => {
    expect(html).toMatch(/title="[^"]*hạn mức[^"]*"/);
  });
});

describe('AiIssuePanel — nối dây (đọc source)', () => {
  const src = readFileSync(join(__dirname, 'AiIssuePanel.tsx'), 'utf8');
  it('huỷ không toast lỗi: toast chỉ ở nhánh failed của hook; hiện chip nguồn dưới lời giải thích', () => {
    expect(src).toMatch(/<AiSourceChips/);
    expect(src).toMatch(/<SuggestProgress/);
    expect(src).not.toMatch(
      /onError: \(e\) => toast\.error\(apiErrorMessage\(e\)\),\s*\}\s*\)\s*\}\s*>\s*Gợi ý/,
    );
  });
});
