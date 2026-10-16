import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSION_CATALOG, SYSTEM_ROLE_META } from '@tirapro/types';
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

describe('thuật ngữ (UX_CONVENTIONS §19) — bộ B', () => {
  it('không còn "issue" trong chuỗi hiển thị (chuỗi có chữ Việt, hoặc JSX kiểu "{n} issue")', () => {
    // Chỉ xét NỘI DUNG chuỗi ("…", '…', `…` bỏ phần ${…}) và chữ JSX giữa `>…<`; biến `issue.key`, khoá cache, quyền… không bị bắt.
    // Bỏ dòng dữ liệu/kỹ thuật: từ khoá tìm kiếm của bảng lệnh (`value="… issue …"`), id anchor, room, queryKey.
    // Giữ nguyên tên menu thật của Jira người dùng phải bấm ("Xem tất cả issue → Xuất → CSV").
    const isUi = (l: string) =>
      !/value="|room="|queryKey|can\('|id="|href="#|Xem tất cả issue/.test(l);
    const VI = /[À-ỹ]/;
    const ISSUE = /\bissues?\b/i;
    const found = hits(/./, (raw) => {
      if (!isUi(raw)) return false;
      // `${…}` và biến mẫu `{{issue.key}}` của tự động hoá là code, không phải chữ hiển thị.
      const line = raw.replace(/\$\{[^}]*\}/g, '#').replace(/\{\{[^}]*\}\}/g, '#');
      if (/\}[ ]+issues?\b(?![=.:\w])/i.test(line)) return true; // JSX: {n} issue
      const pieces = [...line.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`|>([^<>{}]+)</g)].map(
        (m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? '',
      );
      return pieces.some((t) => ISSUE.test(t) && VI.test(t));
    });
    expect([...new Set(found)]).toEqual([]);
  });
  it('"vấn đề" chỉ còn ở sổ rủi ro (RAID)', () => {
    // Ngoại lệ: trang Hướng dẫn giải thích bốn nhóm RAID (dòng nhắc "giả định").
    const raidDoc = (l: string) => !/giả định/.test(l);
    expect(hits(/vấn đề/i, raidDoc).filter((x) => !x.startsWith('features/raid/'))).toEqual([]);
  });
  it('mô tả quyền và vai trò hệ thống dùng tiếng Việt thống nhất', () => {
    const bad =
      /\b(project|workspace|issue|backlog|board|workflow|worklog|saved filter|custom field|migration)\b/i;
    expect(PERMISSION_CATALOG.filter((p) => bad.test(p.description)).map((p) => p.key)).toEqual([]);
    expect(
      Object.entries(SYSTEM_ROLE_META)
        .filter(([, m]) => bad.test(m.description))
        .map(([k]) => k),
    ).toEqual([]);
  });
});
