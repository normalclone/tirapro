import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const all = (readdirSync(root, { recursive: true }) as string[]).filter(
  (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
);

describe('008 · sao chép dùng chung một cách', () => {
  it('chỉ lib/copyText.ts được gọi navigator.clipboard', () => {
    const offenders = all.filter(
      (f) =>
        /navigator\.clipboard/.test(read(f)) && relative(root, join(root, f)) !== 'lib/copyText.ts',
    );
    expect(offenders).toEqual([]);
  });
  it('hook dùng COPIED_FLASH_MS, không tự đặt thời lượng', () => {
    const s = read('lib/useCopyToClipboard.ts');
    expect(s).toContain('COPIED_FLASH_MS');
    expect(s).not.toMatch(/\b2000\b/);
  });
  it('trang chi tiết và panel xem nhanh dùng useIssueCopy; liên kết không lấy window.location.href', () => {
    for (const f of [
      'features/issues/IssueDetailPage.tsx',
      'features/issues/peek/IssuePeekPanel.tsx',
    ]) {
      const s = read(f);
      expect(s, f).toContain('useIssueCopy');
      expect(s, f).not.toContain('window.location.href');
    }
  });
  it('useIssueCopy ghép liên kết bằng issueUrl', () => {
    const s = read('features/issues/useIssueCopy.ts');
    expect(s).toContain('issueUrl(');
  });
  it('panel xem nhanh có nút sao chép liên kết', () => {
    expect(read('features/issues/peek/IssuePeekPanel.tsx')).toContain('Sao chép liên kết');
  });
  it('ô ✓ không tự setTimeout riêng cho việc sao chép trong các nơi đã chuẩn hoá', () => {
    for (const f of [
      'features/api-keys/ApiKeysPage.tsx',
      'features/integrations/RepositorySection.tsx',
      'features/docs/DocumentationPage.tsx',
    ]) {
      expect(read(f), f).not.toMatch(/setTimeout\(\(\) => set(Done|Copied)\(false\)/);
    }
  });
  it('phím y ở chi tiết gọi copyLink qua ref (không đóng băng key cũ trong effect)', () => {
    const s = read('features/issues/IssueDetailPage.tsx');
    expect(s).toMatch(/const copyLinkRef = useRef\(copyLink\);\s*copyLinkRef\.current = copyLink;/);
    expect(s).toContain('copyLinkRef.current()');
    expect(s).not.toMatch(/e\.key === 'y'[^}]*\bcopyLink\(\)/);
  });
  it('"Chép lý do" báo lỗi bằng cùng câu của useCopyToClipboard khi không chép được', () => {
    const t = read('features/issues/useIssueTransitions.tsx');
    expect(t).toContain('COPY_FAILED_MESSAGE');
    expect(t).not.toMatch(/writeClipboard\(text\),/);
    expect(read('lib/useCopyToClipboard.ts')).toMatch(/export const COPY_FAILED_MESSAGE/);
  });
  it('nút # ở chi tiết có vòng focus-visible như nút trong peek', () => {
    const s = read('features/issues/IssueDetailPage.tsx');
    const at = s.indexOf('onClick={copyKey}');
    expect(s.slice(at, at + 700)).toContain('focus-visible:ring-2');
  });
});
