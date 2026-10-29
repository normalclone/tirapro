import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}
const files = walk(root).map((p) => ({
  rel: p.slice(root.length + 1),
  text: readFileSync(p, 'utf8'),
}));

describe('một SectionCard duy nhất (B-T2)', () => {
  it('chỉ có components/ui/SectionCard.tsx, không còn file SectionCard.tsx nào khác', () => {
    expect(files.map((f) => f.rel).filter((r) => /(^|\/)SectionCard\.tsx$/.test(r))).toEqual([
      'components/ui/SectionCard.tsx',
    ]);
  });
  it('không khai báo SectionCard/Card cục bộ có khung viền + tiêu đề h2', () => {
    const bad = files
      .filter((f) => f.rel !== 'components/ui/SectionCard.tsx')
      .filter((f) => /function SectionCard\b/.test(f.text))
      .map((f) => f.rel);
    expect(bad).toEqual([]);
  });
  it('mọi chỗ dùng đều import từ @/components/ui/SectionCard', () => {
    const bad = files
      .filter((f) => /<SectionCard\b/.test(f.text))
      .filter((f) => f.rel !== 'components/ui/SectionCard.tsx')
      .filter((f) => !f.text.includes("from '@/components/ui/SectionCard'"))
      .map((f) => f.rel);
    expect(bad).toEqual([]);
  });
  it('không còn ô icon tự vẽ (mt-0.5 flex h-8 w-8 … rounded-md) ngoài SectionCard', () => {
    const bad = files
      .filter((f) => f.rel !== 'components/ui/SectionCard.tsx')
      .filter((f) =>
        /mt-0\.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md/.test(f.text),
      )
      .map((f) => f.rel);
    expect(bad).toEqual([]);
  });
  it('hai neo tour của danh sách/thêm thành viên nằm trên SectionCard', () => {
    const read = (rel: string) => files.find((f) => f.rel === rel)!.text;
    expect(read('features/members/MembersPage.tsx')).toMatch(
      /<SectionCard\b[\s\S]{0,400}?\bdata-tour="members-list"/,
    );
    expect(read('features/members/AddMemberPanel.tsx')).toMatch(
      /<SectionCard\b[\s\S]{0,400}?\bdata-tour="members-add"/,
    );
  });
});
