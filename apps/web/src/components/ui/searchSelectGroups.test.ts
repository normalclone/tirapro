import { describe, expect, it } from 'vitest';
import { groupHeadingAt } from './searchSelectGroups';

describe('groupHeadingAt', () => {
  const opts = [
    { group: undefined },
    { group: 'Của tôi' },
    { group: 'Của tôi' },
    { group: 'Cả tổ chức' },
    { group: undefined },
    { group: 'Cả tổ chức' },
  ];

  it('chỉ lựa chọn đầu mỗi nhóm liên tiếp có tiêu đề', () => {
    expect(opts.map((_, i) => groupHeadingAt(opts, i))).toEqual([
      null,
      'Của tôi',
      null,
      'Cả tổ chức',
      null,
      'Cả tổ chức',
    ]);
  });

  it('không có group (cách dùng cũ) → không bao giờ có tiêu đề; lọc ra còn một mục vẫn có tiêu đề', () => {
    const plain = [{}, {}, {}];
    expect(plain.map((_, i) => groupHeadingAt(plain, i))).toEqual([null, null, null]);
    expect(groupHeadingAt([{ group: 'A' }], 0)).toBe('A');
  });
});
