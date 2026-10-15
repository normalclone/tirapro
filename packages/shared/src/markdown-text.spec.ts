import { describe, expect, it } from 'vitest';
import {
  countTasks,
  extractIssueKeys,
  extractMentionIds,
  listTaskItems,
  mentionToken,
  mentionsToPlain,
  plainExcerpt,
  setTaskChecked,
  uncheckAllTasks,
} from './markdown-text';

describe('mention token', () => {
  it('mentionToken làm sạch [ ] và xuống dòng trong tên', () => {
    expect(mentionToken('u1', 'Dũng [Dev]\n')).toBe('@[Dũng Dev](user:u1)');
    expect(mentionToken('u1', '   ')).toBe('@[Người dùng](user:u1)');
  });
  it('extractMentionIds: duy nhất, giữ thứ tự, tối đa 20, bỏ token hỏng', () => {
    const t = `${mentionToken('a', 'A')} ${mentionToken('b', 'B')} ${mentionToken('a', 'A')} @[x](http://e.co)`;
    expect(extractMentionIds(t)).toEqual(['a', 'b']);
    const many = Array.from({ length: 30 }, (_, i) => mentionToken(`u${i}`, 'N')).join(' ');
    expect(extractMentionIds(many)).toHaveLength(20);
  });
  it('mentionsToPlain', () => {
    expect(mentionsToPlain('Chào @[Dũng (Dev)](user:u1)!')).toBe('Chào @Dũng (Dev)!');
  });
});

describe('task list', () => {
  const md = [
    'Mô tả',
    '- [ ] Đăng ký bằng email',
    '- [x] Đăng nhập',
    '```',
    '- [ ] trong code',
    '```',
    '  * [X] Mục lồng',
    '- thường',
  ].join('\n');
  it('listTaskItems bỏ qua khối code, chỉ số theo thứ tự', () => {
    expect(listTaskItems(md).map((i) => [i.index, i.checked, i.text])).toEqual([
      [0, false, 'Đăng ký bằng email'],
      [1, true, 'Đăng nhập'],
      [2, true, 'Mục lồng'],
    ]);
  });
  it('countTasks', () => {
    expect(countTasks(md)).toEqual({ done: 2, total: 3 });
    expect(countTasks('không có')).toBeNull();
    expect(countTasks(null)).toBeNull();
  });
  it('setTaskChecked đổi đúng mục, giữ nguyên phần còn lại', () => {
    const out = setTaskChecked(md, 0, true)!;
    expect(out.split('\n')[1]).toBe('- [x] Đăng ký bằng email');
    expect(out.split('\n')[4]).toBe('- [ ] trong code'); // không đụng khối code
    expect(setTaskChecked(md, 1, false)!.split('\n')[2]).toBe('- [ ] Đăng nhập');
  });
  it('setTaskChecked: index ngoài phạm vi hoặc expectText lệch → null', () => {
    expect(setTaskChecked(md, 9, true)).toBeNull();
    expect(setTaskChecked(md, 0, true, 'Văn bản khác')).toBeNull();
    expect(setTaskChecked(md, 0, true, 'Đăng ký bằng email')).not.toBeNull();
  });
  it('uncheckAllTasks (dùng khi tạo bản sao)', () => {
    expect(countTasks(uncheckAllTasks(md))).toEqual({ done: 0, total: 3 });
  });
});

describe('plainExcerpt', () => {
  it('bỏ cú pháp Markdown + đổi token mention', () => {
    expect(plainExcerpt('Chào @[Dũng (Dev)](user:u1) xem **giúp** [link](http://x.y) nhé')).toBe(
      'Chào @Dũng (Dev) xem giúp link nhé',
    );
  });
  it('cắt ở 80 ký tự kèm …, tổng không quá 80', () => {
    const out = plainExcerpt('a'.repeat(200));
    expect(out).toHaveLength(80);
    expect(out.endsWith('…')).toBe(true);
    expect(plainExcerpt(null)).toBe('');
  });
});

describe('extractIssueKeys', () => {
  it('nhận mã nhiều đoạn, không dính ký tự liền kề', () => {
    expect(
      extractIssueKeys('Xem DEMO-STORY-3, DEMO-3 và (DEMO-BUG-12). Lặp DEMO-3; abcDEMO-9'),
    ).toEqual(['DEMO-STORY-3', 'DEMO-3', 'DEMO-BUG-12']);
  });
});
