import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
  });
}
const files = walk(join(__dirname, '..', '..', 'features'));
const rel = (f: string) => f.split('/src/')[1] ?? f;

// Khối viền đứt KHÔNG phải trạng thái trống (vùng thả, đồ thị quy trình, ảnh lỗi).
// Cột board rỗng (Column.tsx) là vùng thả nên cũng được giữ.
const DASHED_ALLOW = new Set([
  'features/workflow-settings/WorkflowGraph.tsx',
  'features/workflow-settings/WorkflowViewDialog.tsx',
  'features/attachments/AttachmentImage.tsx',
  'features/board/Column.tsx',
  // Nút "bấm để viết" (lời mời nhập liệu, không phải trạng thái trống của danh sách).
  'features/issue-edit/DescriptionEditor.tsx',
  // Ghi chú cảnh báo trong kết quả AI ("chưa có sprint để tính velocity"), không phải khối trống.
  'features/ai/SprintAssistantDialog.tsx',
]);

// Thẻ <p>/<div>/<span> tự vẽ thành "khối" (bo góc + viền hoặc nền) mà chữ đầu là "Chưa có"/"Không có".
const BOX_TAG = /<(?:p|div|span)\b((?:(?!<)[^])*?)>\s*(?:Chưa có|Không có)/g;
const isBox = (attrs: string) => /\brounded-/.test(attrs) && /\bborder\b|\bbg-/.test(attrs);

function handDrawnEmpties(src: string): number {
  let n = 0;
  // 1) Khối viền đứt: border-dashed rồi, trong vòng 3 dòng tiếp theo, có chữ trạng thái trống.
  const lines = src.split('\n');
  lines.forEach((l, i) => {
    if (/border-dashed/.test(l) && /(Chưa có|Không có)/i.test(lines.slice(i, i + 4).join('\n')))
      n++;
  });
  // 3) `emptyState={<p>…` của QueryBoundary: phải dùng <EmptyState>, không phải đoạn chữ trần.
  n += [...src.matchAll(/emptyState=\{\s*<(?:p|span)\b/g)].length;
  // 2) Khối đặc/viền liền tự vẽ (không đứt) mang chữ "Chưa có"/"Không có".
  for (const m of src.matchAll(BOX_TAG)) {
    const attrs = m[1] ?? '';
    if (isBox(attrs) && !/border-dashed/.test(attrs)) n++;
  }
  return n;
}

describe('EmptyState là cách duy nhất vẽ trạng thái trống', () => {
  it('feature không tự vẽ khối trống (viền đứt, ô nền hoặc emptyState chữ trần) kèm chữ "Chưa có"/"Không có"', () => {
    const bad = files.filter(
      (f) => !DASHED_ALLOW.has(rel(f)) && handDrawnEmpties(readFileSync(f, 'utf8')) > 0,
    );
    expect(bad.map(rel)).toEqual([]);
  });
  it('bộ dò bắt được khối tự vẽ mới (không bị mù)', () => {
    expect(
      handDrawnEmpties(
        '<p className="rounded-md border border-dashed border-border px-3">Chưa có gì</p>',
      ),
    ).toBe(1);
    expect(
      handDrawnEmpties(
        '<div\n  className="rounded-lg border border-dashed px-4"\n>\n  Không có việc nào\n</div>',
      ),
    ).toBe(1);
    expect(
      handDrawnEmpties('<p className="rounded-md bg-surface-2 px-3 py-2">Không có việc</p>'),
    ).toBe(1);
    expect(
      handDrawnEmpties('<Q emptyState={\n  <p className="py-6">Chưa có trang nào</p>\n}'),
    ).toBe(1);
    expect(handDrawnEmpties('<EmptyState icon={<X />} title="Chưa có gì" />')).toBe(0);
  });
  it('không còn emoji trong chữ trạng thái trống', () => {
    const bad = files.filter((f) =>
      /(Chưa có|Không có)[^'"`<]*[\u{1F300}-\u{1FAFF}]/u.test(readFileSync(f, 'utf8')),
    );
    expect(bad.map(rel)).toEqual([]);
  });
});
