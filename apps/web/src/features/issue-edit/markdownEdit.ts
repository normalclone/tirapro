/** Hàm thuần chỉnh văn bản Markdown cho thanh công cụ của MarkdownEditor (test được không cần DOM). */

export interface TextEdit {
  value: string;
  selStart: number;
  selEnd: number;
}

const CHECKLIST_PREFIX = '- [ ] ';
const CHECKLIST_ANY = /^- \[[ xX]\] /;

/**
 * Công tắc tiền tố theo dòng cho mọi dòng chạm vào vùng chọn: tất cả đã có → bỏ, ngược lại → thêm cho các dòng
 * chưa có. Dòng trống bị bỏ qua (trừ khi chỉ có dòng trống). Với tiền tố checklist, `- [x] ` cũng tính là "đã có".
 * Vùng chọn trả về bao các dòng vừa đổi.
 */
export function toggleLinePrefix(
  value: string,
  selStart: number,
  selEnd: number,
  prefix: string,
): TextEdit {
  const checklist = prefix === CHECKLIST_PREFIX;
  const has = (line: string) => (checklist ? CHECKLIST_ANY.test(line) : line.startsWith(prefix));
  const strip = (line: string) =>
    checklist ? line.replace(CHECKLIST_ANY, '') : line.slice(prefix.length);

  const lineStart = selStart === 0 ? 0 : value.lastIndexOf('\n', selStart - 1) + 1;
  // Vùng chọn kết thúc ngay sau dấu xuống dòng (chọn nguyên dòng) thì dòng kế tiếp không tính.
  const effEnd = selEnd > selStart && value[selEnd - 1] === '\n' ? selEnd - 1 : selEnd;
  const nl = value.indexOf('\n', effEnd);
  const lineEnd = nl === -1 ? value.length : nl;

  const lines = value.slice(lineStart, lineEnd).split('\n');
  const nonBlank = lines.filter((l) => l.trim() !== '');
  const targets = nonBlank.length ? nonBlank : lines;
  const remove = targets.every(has);
  const next = lines.map((l) => {
    if (!nonBlank.length || l.trim() !== '') {
      if (remove) return has(l) ? strip(l) : l;
      return has(l) ? l : prefix + l;
    }
    return l;
  });
  const block = next.join('\n');
  return {
    value: value.slice(0, lineStart) + block + value.slice(lineEnd),
    selStart: lineStart,
    selEnd: lineStart + block.length,
  };
}

const TABLE_TEMPLATE = '| Cột 1 | Cột 2 | Cột 3 |\n| --- | --- | --- |\n|  |  |  |\n';

/** Chèn bảng mẫu 3 cột tại con trỏ (trên dòng riêng, cách đoạn trước một dòng trống) và chọn sẵn "Cột 1". */
export function insertTableTemplate(value: string, caret: number): TextEdit {
  const before = value.slice(0, caret);
  const lead = caret === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const start = caret + lead.length + 2; // sau "| "
  return {
    value: before + lead + TABLE_TEMPLATE + value.slice(caret),
    selStart: start,
    selEnd: start + 'Cột 1'.length,
  };
}
