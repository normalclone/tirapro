import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMENT_REACTION_EMOJIS } from '@tirapro/shared';
import type { CommentReactionDto } from '@tirapro/types';
import { REACTION_LABELS } from './commentReactions';
import { ReactionChip, ReactionPickerPanel } from './CommentReactionStrip';

const r = (
  emoji: string,
  count: number,
  mine: boolean,
  names: string[] = [],
): CommentReactionDto => ({
  emoji,
  count,
  mine,
  users: names.map((n) => ({ id: n === 'Tôi' ? 'me' : `id-${n}`, displayName: n })),
});
const noop = () => undefined;

describe('ReactionChip', () => {
  it('chip tương tác: button, aria-pressed theo `mine`, tên = "emoji số — ai", danh sách tên ở aria-describedby + title', () => {
    const html = renderToStaticMarkup(
      <ReactionChip reaction={r('👍', 3, true, ['An', 'Tôi', 'Bình'])} meId="me" onToggle={noop} />,
    );
    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="👍 3 — bạn và 2 người khác"');
    const desc = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(desc).toBeTruthy();
    expect(html).toContain(`id="${desc}"`);
    expect(html).toContain('Bạn, An và Bình');
    expect(html).toMatch(/title="Bạn, An và Bình"/);
  });
  it('chưa mine: aria-pressed=false', () => {
    const html = renderToStaticMarkup(
      <ReactionChip reaction={r('🎉', 1, false, ['An'])} meId="me" onToggle={noop} />,
    );
    expect(html).toContain('aria-pressed="false"');
  });
  it('chỉ-đọc (dự án lưu trữ): KHÔNG phải button, không aria-pressed, vẫn có tên và số', () => {
    const html = renderToStaticMarkup(
      <ReactionChip reaction={r('👍', 2, true, ['An', 'Tôi'])} meId="me" onToggle={null} />,
    );
    expect(html).not.toContain('<button');
    expect(html).not.toContain('aria-pressed');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="👍 2 — bạn và 1 người khác"');
  });
  it('mục tiêu chạm: chip dùng CHIP_TOUCH_HIT (mở dọc lên 44px trên cảm ứng), không dùng màu một mình để báo trạng thái', () => {
    const html = renderToStaticMarkup(
      <ReactionChip reaction={r('👍', 2, true, ['An', 'Tôi'])} meId="me" onToggle={noop} />,
    );
    expect(html).toContain('[@media(pointer:coarse)]:after:-inset-y-[9px]');
    expect(html).toContain('font-semibold'); // chip của mình đậm hơn: không chỉ khác màu
  });
});

describe('ReactionPickerPanel', () => {
  const html = renderToStaticMarkup(
    <ReactionPickerPanel
      reactions={[r('🎉', 1, true, ['Tôi'])]}
      onPick={noop}
      firstRef={{ current: null }}
    />,
  );
  it('nhóm có nhãn, đủ 6 nút với tên tiếng Việt, aria-pressed theo mine', () => {
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Chọn cảm xúc"');
    for (const e of COMMENT_REACTION_EMOJIS)
      expect(html).toContain(`aria-label="${REACTION_LABELS[e]}"`);
    expect(html.match(/<button/g)).toHaveLength(6);
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
  });
  it('roving tabindex: đúng MỘT ô tabIndex=0 (ô đã chọn đầu tiên), còn lại -1', () => {
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1);
    expect((html.match(/tabindex="-1"/g) ?? []).length).toBe(5);
    const idx = html.indexOf('tabindex="0"');
    expect(html.slice(idx - 300, idx + 300)).toContain(REACTION_LABELS['🎉']);
  });
  it('mục tiêu chạm 44px trên cảm ứng', () => {
    expect(html).toContain('[@media(pointer:coarse)]:h-11');
    expect(html).toContain('[@media(pointer:coarse)]:w-11');
  });
});

describe('CommentReactions — nối dây (đọc source)', () => {
  const src = readFileSync(join(__dirname, 'CommentReactionStrip.tsx'), 'utf8');
  it('ẩn "+" khi dự án lưu trữ/không xem được bằng hook cổng có sẵn; không chọn `s.can` thô', () => {
    expect(src).toMatch(/useCanIn\(/);
    expect(src).toMatch(/useProjectArchived\(/);
    expect(src).not.toMatch(/useAuth\(\(s\) => s\.can\)/);
  });
  it('emoji lấy từ hằng dùng chung, không tự gõ danh sách', () => {
    expect(src).toMatch(/COMMENT_REACTION_EMOJIS/);
    expect(src).not.toMatch(/'👍', '❤️'/);
  });
});
