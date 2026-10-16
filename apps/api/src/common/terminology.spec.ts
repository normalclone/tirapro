import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Quét mã nguồn chặn tái phạm thuật ngữ ở chuỗi API trả/gửi cho người dùng (docs/UX_CONVENTIONS.md §19):
 * "công việc" thay "issue", "Việc chờ" thay "Backlog", tên sprint thân thiện thay vì enum ACTIVE/FUTURE/CLOSED.
 * Mã cho người vận hành (log, health, api-help) không thuộc phạm vi.
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
  /modules\/health\//,
  /fulltext\.ts$/,
  /api-help\.controller\.ts$/,
  /jira-csv\.parser\.ts$/, // tên cột Jira ("Issue key", "Summary") là chữ thật trong tệp Jira
];
/** Dòng mang chữ trả/gửi cho người dùng. */
const USER_FACING = /(Exception\(|message:|title:|reasons\.push\(|lines\s*=|\.push\()/;
const TERM_BAD =
  /\b(issues?|Issue|Backlog|backlog|ACTIVE|FUTURE|CLOSED|workflow|worklog|project|workspace)\b/i;
/** Lời chỉ dẫn gửi Claude (nhiều dòng nối chuỗi): kết quả Claude lặp lại từ trong chỉ dẫn nên quét MỌI chuỗi tiếng Việt. */
const PROMPT_FILES = /modules\/ai\//;
/** Chữ trích menu thật của Jira người dùng phải bấm — giữ nguyên. */
const JIRA_UI = /Export issues|Xem tất cả issue|Issue key/;
/** Tên thẻ phân tách trong prompt (`<issue>`) là KÝ HIỆU kỹ thuật chống tiêm lệnh — không đổi tên. */
const PROMPT_TAG = /thẻ <issue>/;

function quoted(line: string): string[] {
  const noTpl = line.replace(/\$\{[^}]*\}/g, '#');
  return [...noTpl.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? '',
  );
}

describe('thuật ngữ API', () => {
  it('chuỗi trả cho người dùng không dùng "issue"/"Backlog"/tên enum sprint', () => {
    const root = join(__dirname, '..', 'modules');
    const bad = walk(root)
      .filter((f) => !SKIP.some((s) => s.test(f.replace(/\\/g, '/'))))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .map((l, i) => ({ f, i: i + 1, l }))
          .filter(
            ({ l }) =>
              !/^\s*(\/\/|\*|\/\*)/.test(l) &&
              (USER_FACING.test(l) || PROMPT_FILES.test(f)) &&
              !JIRA_UI.test(l) &&
              !PROMPT_TAG.test(l) &&
              quoted(l).some((t) => /[À-ỹ]/.test(t) && TERM_BAD.test(t)),
          )
          .map(({ f, i }) => `${f.split('/src/')[1]}:${i}`),
      );
    expect(bad).toEqual([]);
  });
});
