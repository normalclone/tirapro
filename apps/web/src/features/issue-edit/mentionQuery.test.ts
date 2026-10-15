import { describe, expect, it } from 'vitest';
import { applyMention, filterMentionCandidates, findMentionTrigger } from './mentionQuery';

const people = [
  { id: 'u1', name: 'Dũng (Dev)', email: 'dev@tirapro.dev' },
  { id: 'u2', name: 'Bình (BA)', email: 'ba@tirapro.dev' },
  { id: 'u3', name: 'Trang (Tester)', email: 'tester@tirapro.dev' },
  { id: 'u4', name: 'Đức Anh', email: 'ducanh@x.vn' },
];

describe('findMentionTrigger', () => {
  it('@ đầu dòng hoặc sau khoảng trắng', () => {
    expect(findMentionTrigger('@', 1)).toEqual({ start: 0, query: '' });
    expect(findMentionTrigger('Chào @du', 8)).toEqual({ start: 5, query: 'du' });
    expect(findMentionTrigger('a\n@b', 4)).toEqual({ start: 2, query: 'b' });
  });
  it('không kích khi @ nằm giữa từ (email) hoặc có xuống dòng giữa @ và con trỏ', () => {
    expect(findMentionTrigger('mail a@b.c', 10)).toBeNull();
    expect(findMentionTrigger('@b\nc', 4)).toBeNull();
  });
  it('cho phép dấu cách trong truy vấn nhưng không quá 25 ký tự', () => {
    expect(findMentionTrigger('xin @Đức An', 11)).toEqual({ start: 4, query: 'Đức An' });
    expect(findMentionTrigger('@' + 'a'.repeat(30), 31)).toBeNull();
  });
});

describe('filterMentionCandidates', () => {
  it('tìm không dấu, không phân biệt hoa thường, theo tên hoặc email', () => {
    expect(filterMentionCandidates(people, 'dung').map((p) => p.id)).toEqual(['u1']);
    expect(filterMentionCandidates(people, 'duc').map((p) => p.id)).toEqual(['u4']); // Đ → d
    expect(filterMentionCandidates(people, 'tester').map((p) => p.id)).toEqual(['u3']);
  });
  it('tiền tố tên xếp trước khớp giữa chữ; rỗng → sắp theo tên, tối đa limit', () => {
    expect(filterMentionCandidates(people, 'b').map((p) => p.id)[0]).toBe('u2');
    expect(filterMentionCandidates(people, '', 2)).toHaveLength(2);
  });
});

describe('applyMention', () => {
  it('thay @truy-vấn bằng token, caret sau token + 1 dấu cách', () => {
    const r = applyMention('Chào @du nhé', { start: 5, query: 'du' }, 8, people[0]!);
    expect(r.value).toBe('Chào @[Dũng (Dev)](user:u1) nhé');
    expect(r.caret).toBe('Chào @[Dũng (Dev)](user:u1) '.length);
  });
  it('cuối văn bản → thêm dấu cách', () => {
    const r = applyMention('@b', { start: 0, query: 'b' }, 2, people[1]!);
    expect(r.value).toBe('@[Bình (BA)](user:u2) ');
    expect(r.caret).toBe(r.value.length);
  });
});
