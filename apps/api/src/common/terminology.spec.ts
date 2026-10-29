import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Quét mã nguồn chặn tái phạm thuật ngữ ở chuỗi API trả/gửi cho người dùng (docs/UX_CONVENTIONS.md §19):
 * "công việc" thay "issue", "Việc chờ" thay "Backlog", tên sprint thân thiện thay vì enum ACTIVE/FUTURE/CLOSED,
 * dự án / quy trình / không gian làm việc / nhật ký thời gian thay project / workflow / workspace / worklog.
 *
 * Quét MỌI chuỗi tiếng Việt (nháy đơn/kép/backtick, kể cả nhiều dòng) trong `apps/api/src/modules/**` — không phụ thuộc
 * cách viết câu (`throw new …Exception(`, `message:`, nối chuỗi nhiều dòng…) — trừ chuỗi trong lời gọi log cho dev/ops
 * (`logger.*`, `console.*`) và danh sách bỏ qua hẹp bên dưới (mỗi mục có lý do).
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(f) && !/\.spec\.ts$/.test(f)) out.push(p);
  }
  return out;
}

/** File cho dev/ops hoặc phân tích tệp ngoài — không phải chữ hiển thị cho người dùng cuối. */
const SKIP = [
  /modules\/health\//, // /health, api-help: chữ cho người vận hành
  /fulltext\.ts$/, // cảnh báo vận hành (db:raw) hiện ở /health
  /jira-csv\.parser\.ts$/, // tên cột Jira ("Issue key", "Summary") là chữ thật trong tệp Jira
];
const TERM_BAD =
  /\b(issues?|backlog|ACTIVE|FUTURE|CLOSED|workflows?|worklogs?|projects?|workspaces?)\b/i;
const VI = /[À-ỹ]/;
/** Chữ trích menu thật của Jira người dùng phải bấm, hoặc tên thẻ phân tách prompt (`<issue>`) — giữ nguyên. */
const EXEMPT = /Export issues|Xem tất cả issue|Issue key|thẻ <issue>/;
/** Chuỗi nằm trong lời gọi log (dev/ops): `logger.warn(`, `this.logger.error(`, `console.log(` … */
const LOG_CALL = /(?:\blogger|\bconsole)\s*\.\s*\w+\s*\(\s*$/;

interface Lit {
  text: string;
  line: number;
  before: string;
}

/** `/` ở vị trí `i` mở regex literal (không phải phép chia)? Dựa vào ký tự có nghĩa đứng ngay trước. */
function regexAllowedAfter(src: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && /[ \t]/.test(src[j]!)) j--;
  if (j < 0 || src[j] === '\n') return true;
  if (/[(,=:[!&|?{};+\-*%<>~^]/.test(src[j]!)) return true;
  return /\b(?:return|typeof|case|throw|yield|await|in|of)$/.test(
    src.slice(Math.max(0, j - 7), j + 1),
  );
}

/** Tách mọi chuỗi ('…', "…", `…` — bỏ phần ${…}) ra khỏi mã, bỏ qua comment; ghi dòng bắt đầu + đoạn mã ngay trước. */
export function extractStrings(src: string): Lit[] {
  const out: Lit[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === '\n') {
      line++;
      i++;
    } else if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      i += 2;
    } else if (c === '/' && regexAllowedAfter(src, i)) {
      // Regex literal (vd /`{3,}/): bỏ qua tới dấu `/` đóng (không tính `/` trong lớp [...] hoặc sau `\`), tránh lật chẵn lẻ nháy.
      i++;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        const ch = src[i]!;
        if (ch === '\\') i++;
        else if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        i++;
      }
      i++;
    } else if (c === "'" || c === '"' || c === '`') {
      const start = i;
      const startLine = line;
      let text = '';
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') {
          text += src[i + 1] ?? '';
          if (src[i + 1] === '\n') line++;
          i += 2;
          continue;
        }
        if (c === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 1;
          i += 2;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            else if (src[i] === '\n') line++;
            i++;
          }
          text += '#';
          continue;
        }
        if (src[i] === '\n') {
          line++;
          if (c !== '`') break; // chuỗi đơn/kép không xuống dòng — thoát để không "nuốt" mã
        }
        text += src[i];
        i++;
      }
      i++;
      out.push({ text, line: startLine, before: src.slice(Math.max(0, start - 120), start) });
    } else i++;
  }
  return out;
}

const isViolation = (l: Lit) =>
  VI.test(l.text) && TERM_BAD.test(l.text) && !EXEMPT.test(l.text) && !LOG_CALL.test(l.before);

describe('thuật ngữ API', () => {
  it('chuỗi tiếng Việt trong modules/** không dùng "issue"/"Backlog"/tên enum sprint/project/workflow/…', () => {
    const root = join(__dirname, '..', 'modules');
    const bad = walk(root)
      .filter((f) => !SKIP.some((s) => s.test(f.replace(/\\/g, '/'))))
      .flatMap((f) =>
        extractStrings(readFileSync(f, 'utf8'))
          .filter(isViolation)
          .map((l) => `${f.split('/src/')[1]}:${l.line}`),
      );
    expect(bad).toEqual([]);
  });

  it('bộ quét tự kiểm: bắt chuỗi nhiều dòng / nối chuỗi, bỏ qua log và chuỗi Jira', () => {
    const lits = (code: string) => extractStrings(code).filter(isViolation);
    // chuỗi nhiều dòng (template) — cổng theo dòng cũ bỏ lọt
    expect(lits('const m = `Dòng một\nCòn issue chưa xong\nDòng ba`;')).toHaveLength(1);
    // nối chuỗi: từ cấm ở dòng sau của câu
    expect(
      lits("const m = 'Bạn là trợ lý. ' +\n  'Chọn tập issue phù hợp. ' +\n  'Xong.';"),
    ).toHaveLength(1);
    // tên enum
    expect(lits("throw new X('Đã có sprint đang ACTIVE');")).toHaveLength(1);
    // log cho dev/ops và chuỗi Jira: không tính
    expect(lits('this.logger.warn(`Chụp KR workspace ${id} lỗi`);')).toHaveLength(0);
    expect(lits('const t = \'Xuất từ Jira bằng "Export issues"\';')).toHaveLength(0);
    // chuỗi toàn tiếng Anh/mã (không có chữ Việt) và comment không tính
    expect(lits("const k = 'issue'; // Dòng này nói về issue tiếng Việt")).toHaveLength(0);
    // regex literal chứa backtick không lật chẵn lẻ nháy: chuỗi sau đó vẫn được quét đúng (đúng dòng 3)
    expect(
      extractStrings("const R = /`/;\nconst ok = 'Việc chờ';\nconst bad = 'Còn issue';")
        .filter(isViolation)
        .map((l) => l.line),
    ).toEqual([3]);
    // phép chia không bị nhầm là regex
    expect(lits("const d = a / b; const m = 'Còn issue'; const e = c / d;")).toHaveLength(1);
    // biến trong ${…} không tính là chữ
    expect(lits('const m = `Đã đóng ${issue.key}`;')).toHaveLength(0);
  });
});
