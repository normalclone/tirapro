import { describe, expect, it } from 'vitest';
import { listTaskItems } from '@tirapro/shared';
import { parseMarkdown, type MdBlock } from './markdownParse';

const tasksOf = (blocks: MdBlock[]) =>
  blocks.flatMap((b) =>
    b.type === 'list' ? b.items.flatMap((i) => (i.task ? [i.task] : [])) : [],
  );

describe('parseMarkdown — task list', () => {
  const md = [
    '## Tiêu chí',
    '- [ ] Đăng ký',
    '- [x] Đăng nhập',
    '',
    'Ghi chú',
    '```',
    '- [ ] trong code',
    '```',
    '1. [X] Bước số',
    '- thường',
  ].join('\n');
  it('chỉ số/checked/text của ô tick khớp tuyệt đối với listTaskItems của @tirapro/shared', () => {
    const fromParser = tasksOf(parseMarkdown(md)).map((t) => [t.index, t.checked, t.text]);
    const fromShared = listTaskItems(md).map((t) => [t.index, t.checked, t.text]);
    expect(fromParser).toEqual(fromShared);
    expect(fromParser).toEqual([
      [0, false, 'Đăng ký'],
      [1, true, 'Đăng nhập'],
      [2, true, 'Bước số'],
    ]);
  });
  it('khối code giữ nguyên nội dung, không thành danh sách', () => {
    const code = parseMarkdown(md).find((b) => b.type === 'code');
    expect(code).toMatchObject({ type: 'code', text: '- [ ] trong code' });
  });
  it('khối code không đóng → phần còn lại là code', () => {
    expect(parseMarkdown('```\nabc\n- x')).toEqual([{ type: 'code', lang: '', text: 'abc\n- x' }]);
  });
});

describe('parseMarkdown — bảng', () => {
  it('nhận bảng có căn lề và ô thiếu', () => {
    const [t] = parseMarkdown(
      '| Vai trò | Quyền | Ghi chú |\n|:--|:-:|--:|\n| BA | Viết wiki |\n| Dev | Sửa \\| việc | x |',
    );
    expect(t).toMatchObject({
      type: 'table',
      align: ['left', 'center', 'right'],
      header: ['Vai trò', 'Quyền', 'Ghi chú'],
      rows: [
        ['BA', 'Viết wiki', ''],
        ['Dev', 'Sửa | việc', 'x'],
      ],
    });
  });
  it('dòng có | nhưng không có dòng phân cách → đoạn văn thường', () => {
    expect(parseMarkdown('a | b\nc')[0]).toMatchObject({ type: 'paragraph' });
  });
});

describe('parseMarkdown — khác', () => {
  it('danh sách số, trích dẫn, tiêu đề', () => {
    const b = parseMarkdown('# T\n1. a\n2) b\n> trích\n> tiếp');
    expect(b[0]).toMatchObject({ type: 'heading', level: 1, text: 'T' });
    expect(b[1]).toMatchObject({ type: 'list', ordered: true });
    expect((b[1] as Extract<MdBlock, { type: 'list' }>).items.map((i) => i.text)).toEqual([
      'a',
      'b',
    ]);
    expect(b[2]).toEqual({ type: 'quote', lines: ['trích', 'tiếp'] });
  });
  it('hành vi cũ: mỗi dòng không trống là một đoạn, dòng trống là khoảng cách', () => {
    expect(parseMarkdown('a\nb\n\nc').map((x) => x.type)).toEqual([
      'paragraph',
      'paragraph',
      'blank',
      'paragraph',
    ]);
  });
  it('*nghiêng* đầu dòng không bị nhận nhầm là gạch đầu dòng', () => {
    expect(parseMarkdown('*nghiêng* chữ')[0]).toMatchObject({ type: 'paragraph' });
  });
});
