import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');
const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');
const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('mobile nền chung', () => {
  it('ô nhập 16px dưới sm để iOS không phóng to', () => {
    expect(css).toMatch(
      /@media \(max-width: 639px\)[\s\S]*?(input|textarea)[\s\S]*?font-size:\s*16px/,
    );
  });
  it('có lớp scroll-fade-x', () => expect(css).toMatch(/\.scroll-fade-x/));
  it('viewport-fit=cover', () => expect(html).toMatch(/viewport-fit=cover/));
  it('nút nổi tránh thanh home iOS', () =>
    expect(src('components/layout/FloatingActions.tsx')).toMatch(/safe-area-inset-bottom/));
  it('dải menu phụ cuộn ngang có dấu hiệu còn nội dung', () => {
    for (const f of [
      'features/settings/SettingsLayout.tsx',
      'features/manage/ManageLayout.tsx',
      'features/connect/ConnectLayout.tsx',
      'features/integrations/IntegrationsPage.tsx',
      'features/project-config/ProjectConfigPage.tsx',
    ])
      expect(src(f), f).toMatch(/scroll-fade-x/);
  });
});
