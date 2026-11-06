import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

/** Vùng chạm ≥ 44px trên cảm ứng: mọi <Button> (kể cả size sm) trong UI Telegram có `pointer:coarse` cao h-11. */
describe('UI Telegram — vùng chạm 44px trên cảm ứng', () => {
  it.each(['TelegramLinkCard.tsx', 'TelegramLinkParts.tsx', 'ProjectTelegramSection.tsx'])(
    '%s: mỗi <Button> có [@media(pointer:coarse)]:h-11',
    (file) => {
      const src = read(file);
      const buttons = src.match(/<Button\b/g)?.length ?? 0;
      const coarse = src.match(/\[@media\(pointer:coarse\)\]:h-11/g)?.length ?? 0;
      expect(buttons).toBeGreaterThan(0);
      expect(coarse).toBeGreaterThanOrEqual(buttons);
    },
  );
  it('liên kết "Mở Telegram" cũng cao 44px trên cảm ứng', () => {
    expect(read('TelegramLinkCard.tsx')).toMatch(/pointer:coarse\)\]:h-11"\s*>\s*<ExternalLink/);
  });
});
