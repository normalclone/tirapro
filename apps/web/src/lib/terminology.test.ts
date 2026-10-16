import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Quét mã nguồn chặn tái phạm thuật ngữ (docs/UX_CONVENTIONS.md §19): một khái niệm = một từ.
 * Chỉ xét dòng KHÔNG phải comment, ngoài `*.test.ts`. Tên định danh code (BacklogPage, useBacklog…) không bị bắt vì
 * rule dùng `\b` + yêu cầu nằm trong chuỗi/JSX.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}
const isComment = (l: string) => /^\s*(\/\/|\*|\/\*)/.test(l);
/** File được phép chứa từ khoá cũ — mỗi mục phải có lý do. */
const ALLOW = [
  // Từ khoá tìm kiếm không dấu/đồng nghĩa: người dùng cũ gõ "backlog" vẫn ra "Việc chờ".
  /features\/command\/commandFilter\.ts$/,
];
/** Dòng được phép: giải thích thuật ngữ lần đầu cho người mới ("Việc chờ (backlog)", "Bảng việc (Board)"). */
const GLOSS = /Việc chờ \(backlog\)|Bảng việc \(Board\)/;

export const hits = (re: RegExp, keep: (line: string) => boolean = () => true) =>
  walk(join(__dirname, '..'))
    .filter((f) => !ALLOW.some((a) => a.test(f.replace(/\\/g, '/'))))
    .flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((l, i) => ({ f, i: i + 1, l }))
        .filter((x) => !isComment(x.l) && !GLOSS.test(x.l) && keep(x.l) && re.test(x.l))
        .map((x) => `${x.f.split('/src/')[1]}:${x.i}`),
    );

describe('thuật ngữ (UX_CONVENTIONS §19) — bộ A', () => {
  it('không còn "Backlog" hiển thị (dùng "Việc chờ")', () => {
    expect(hits(/(["'`>][^"'`<>]*)\bBacklog\b/)).toEqual([]);
  });
  it('không còn "đợt làm việc" (dùng "sprint")', () => {
    expect(hits(/đợt làm việc/i)).toEqual([]);
  });
  it('nhóm trạng thái không dùng "Cần làm"/"Đang làm" (dùng To Do / In Progress qua STATUS_CATEGORY_LABEL)', () => {
    expect(hits(/["'`>](Cần làm|Đang làm)["'`<]/)).toEqual([]);
    // dạng nối chuỗi: `Đang làm ${n}`, `· Cần làm`
    expect(hits(/(Cần làm|Đang làm) \$\{|· (Cần làm|Đang làm)\b/)).toEqual([]);
  });
  it('không còn "Board" hiển thị (dùng "Bảng việc")', () => {
    expect(hits(/(["'`>][^"'`<>]*)\bBoard\b(?! ?(?:Settings|Page|Dialog))/)).toEqual([]);
  });
});
