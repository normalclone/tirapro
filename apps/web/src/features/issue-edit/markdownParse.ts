import { isFenceLine, matchTaskLine } from '@tirapro/shared';

type Align = 'left' | 'center' | 'right' | null;
interface MdListItem {
  text: string;
  depth: number;
  /** Có khi dòng là `- [ ] x` / `- [x] x`; `index` = thứ tự theo `listTaskItems` của @tirapro/shared. */
  task: { index: number; checked: boolean; text: string } | null;
}
export type MdBlock =
  | { type: 'blank' }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; lines: string[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'list'; ordered: boolean; items: MdListItem[] }
  | { type: 'table'; align: Align[]; header: string[]; rows: string[][] };

const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const DELIM_CELL = /^:?-+:?$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const isDelimRow = (line: string) =>
  line.includes('|') && splitRow(line).every((c) => DELIM_CELL.test(c));

const alignOf = (c: string): Align =>
  c.startsWith(':') && c.endsWith(':')
    ? 'center'
    : c.endsWith(':')
      ? 'right'
      : c.startsWith(':')
        ? 'left'
        : null;

/** Dòng task / khối code không bao giờ là một phần của bảng, để chỉ số ô tick luôn khớp `listTaskItems`. */
const startsOtherBlock = (line: string) => isFenceLine(line) || matchTaskLine(line) !== null;

/**
 * Phân tích Markdown (tập con GFM) thành các khối. Hàm thuần — phần React ở `MarkdownView`.
 * Giữ hành vi cũ "mỗi dòng không trống là một đoạn"; danh sách lồng chỉ ghi `depth`, không dựng cây.
 */
export function parseMarkdown(text: string): MdBlock[] {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const blocks: MdBlock[] = [];
  let taskIndex = 0;
  let i = 0;

  const pushItem = (ordered: boolean, item: MdListItem) => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'list' && last.ordered === ordered) last.items.push(item);
    else blocks.push({ type: 'list', ordered, items: [item] });
  };

  while (i < lines.length) {
    const line = lines[i]!;

    if (isFenceLine(line)) {
      const lang = line.trim().replace(/^(```|~~~)\s*/, '');
      const body: string[] = [];
      i++;
      while (i < lines.length && !isFenceLine(lines[i]!)) body.push(lines[i++]!);
      i++; // bỏ dòng đóng (nếu có); khối không đóng → phần còn lại là code
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }

    if (
      line.includes('|') &&
      !startsOtherBlock(line) &&
      i + 1 < lines.length &&
      isDelimRow(lines[i + 1]!)
    ) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]!).map(alignOf);
      const rows: string[][] = [];
      i += 2;
      while (
        i < lines.length &&
        lines[i]!.trim() !== '' &&
        lines[i]!.includes('|') &&
        !startsOtherBlock(lines[i]!)
      ) {
        const cells = splitRow(lines[i++]!).slice(0, header.length);
        while (cells.length < header.length) cells.push('');
        rows.push(cells);
      }
      blocks.push({ type: 'table', align: header.map((_, k) => align[k] ?? null), header, rows });
      continue;
    }

    const q = QUOTE.exec(line);
    if (q) {
      const quote: string[] = [];
      while (i < lines.length) {
        const m = QUOTE.exec(lines[i]!);
        if (!m) break;
        quote.push(m[1] ?? '');
        i++;
      }
      blocks.push({ type: 'quote', lines: quote });
      continue;
    }

    const t = matchTaskLine(line);
    if (t) {
      const indent = /^\s*/.exec(t[1]!)![0].length;
      const taskText = (t[3] ?? '').trim();
      pushItem(/\d/.test(t[1]!), {
        text: taskText,
        depth: Math.floor(indent / 2),
        task: { index: taskIndex++, checked: t[2] !== ' ', text: taskText },
      });
      i++;
      continue;
    }
    const b = BULLET.exec(line);
    if (b) {
      pushItem(false, { text: b[2] ?? '', depth: Math.floor(b[1]!.length / 2), task: null });
      i++;
      continue;
    }
    const o = ORDERED.exec(line);
    if (o) {
      pushItem(true, { text: o[2] ?? '', depth: Math.floor(o[1]!.length / 2), task: null });
      i++;
      continue;
    }

    const h = HEADING.exec(line);
    if (h) blocks.push({ type: 'heading', level: h[1]!.length as 1 | 2 | 3, text: h[2] ?? '' });
    else if (line.trim() === '') blocks.push({ type: 'blank' });
    else blocks.push({ type: 'paragraph', text: line });
    i++;
  }
  return blocks;
}
