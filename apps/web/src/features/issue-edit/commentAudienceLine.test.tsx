import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommentAudienceLine } from './CommentAudienceLine';
import type { AudienceEntry } from './commentAudience';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');
const E = (n: number, reason: AudienceEntry['reason'] = 'watcher'): AudienceEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `u${i}`,
    name: `Người ${i}`,
    avatarUrl: null,
    reason,
  }));

describe('CommentAudienceLine', () => {
  it('rỗng → không vẽ gì', () => {
    expect(renderToStaticMarkup(<CommentAudienceLine entries={[]} />)).toBe('');
  });
  it('tối đa 5 avatar, phần còn lại là "+N"; avatar trang trí (aria-hidden)', () => {
    const out = renderToStaticMarkup(<CommentAudienceLine entries={E(8)} />);
    expect(out.match(/rounded-full bg-primary-subtle/g)).toHaveLength(5);
    expect(out).toContain('+3');
    expect(out).not.toMatch(/title="Người 0"/); // Avatar decorative: không tooltip riêng
  });
  it('đủ 5 người không có "+N"', () => {
    expect(renderToStaticMarkup(<CommentAudienceLine entries={E(5)} />)).not.toContain('+');
  });
  it('có câu sr-only đầy đủ và title cùng nội dung + lời nhắc không hứa quá', () => {
    const out = renderToStaticMarkup(
      <CommentAudienceLine
        entries={[...E(1, 'mentioned'), ...E(2).map((e, i) => ({ ...e, id: `w${i}` }))]}
      />,
    );
    expect(out).toMatch(
      /class="sr-only"[^>]*>Sẽ thông báo cho Người 0 \(được nhắc\) và 2 người theo dõi</,
    );
    expect(out).toMatch(
      /title="Sẽ thông báo cho Người 0 \(được nhắc\) và 2 người theo dõi[^"]*theo cài đặt thông báo/,
    );
  });
  it('KHÔNG phải live region (không đọc lại mỗi lần gõ)', () => {
    const out = renderToStaticMarkup(<CommentAudienceLine entries={E(2)} />);
    expect(out).not.toMatch(/aria-live|role="status"|role="alert"/);
  });
  it('nhãn hiển thị "Sẽ thông báo:" ẩn khỏi trình đọc (đã có câu sr-only)', () => {
    const out = renderToStaticMarkup(<CommentAudienceLine entries={E(1)} />);
    expect(out).toMatch(/aria-hidden="true"[^>]*>Sẽ thông báo:</);
  });
});

describe('nối dây', () => {
  const comments = read('CommentsSection.tsx');
  it('CommentsSection (dùng chung cho trang chi tiết và peek) hiện dòng dưới ô soạn, tính theo draft', () => {
    expect(comments).toMatch(/useCommentAudience\(issue, draft, people/);
    expect(comments).toMatch(/<CommentAudienceLine/);
  });
  it('useCommentAudience: watchers qua useWatchers, memo theo draft', () => {
    const h = read('useCommentAudience.ts');
    expect(h).toMatch(/useWatchers\(/);
    expect(h).toMatch(/useMemo\(/);
    expect(h).toMatch(/commentAudience\(/);
  });
  it('useWatchers dùng key keys.issues.watchers và endpoint có sẵn', () => {
    const api = read('../issue-widgets/api.ts');
    expect(api).toMatch(/keys\.issues\.watchers\(issueId\)/);
    expect(api).toMatch(/\/issues\/\$\{issueId\}\/watchers/);
  });
});
