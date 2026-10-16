import { describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import {
  filterLinkCandidates,
  looksLikeIssueKey,
  suggestionsReady,
  parseRelationValue,
  relationOptions,
} from './linkOptions';

const types = [
  { id: 't1', name: 'Blocks', outwardName: 'blocks', inwardName: 'is blocked by' },
  { id: 't2', name: 'Relates', outwardName: 'relates to', inwardName: 'relates to' },
  { id: 't3', name: 'Causes', outwardName: 'causes', inwardName: 'is caused by' },
];

describe('relationOptions', () => {
  it('mỗi loại hai chiều; loại đối xứng chỉ một mục', () => {
    expect(relationOptions(types).map((o) => [o.value, o.label])).toEqual([
      ['t1:out', 'blocks'],
      ['t1:in', 'is blocked by'],
      ['t2:out', 'relates to'],
      ['t3:out', 'causes'],
      ['t3:in', 'is caused by'],
    ]);
  });
  it('parseRelationValue khứ hồi', () => {
    expect(parseRelationValue('t3:in')).toEqual({ typeId: 't3', direction: 'inward' });
    expect(parseRelationValue('t1:out')).toEqual({ typeId: 't1', direction: 'outward' });
    expect(parseRelationValue('bậy')).toBeNull();
  });
});

describe('looksLikeIssueKey', () => {
  it.each(['PSL-TASK-3', 'demo-story-12', 'ABC-1', 'psl-epic-1'])('%s là mã', (s) =>
    expect(looksLikeIssueKey(s)).toBe(true),
  );
  it.each(['dang ky', 'PSL', 'PSL-', '12', 'sửa lỗi 3'])('%s không phải mã', (s) =>
    expect(looksLikeIssueKey(s)).toBe(false),
  );
});

describe('filterLinkCandidates', () => {
  const r = (id: string) => ({ id, key: id.toUpperCase(), summary: id }) as unknown as IssueDto;
  it('bỏ chính nó và việc đã liên kết, giữ thứ tự', () => {
    expect(
      filterLinkCandidates([r('a'), r('b'), r('c')], 'a', new Set(['c'])).map((i) => i.id),
    ).toEqual(['b']);
  });
});

describe('suggestionsReady — Enter chỉ chọn khi gợi ý khớp đúng chuỗi đang gõ', () => {
  it('đã debounce xong, không còn tải/dữ liệu cũ => sẵn sàng', () => {
    expect(suggestionsReady('dang nhap', 'dang nhap', false)).toBe(true);
    expect(suggestionsReady('  dang nhap ', 'dang nhap', false)).toBe(true); // khoảng trắng đầu/cuối bỏ qua
  });
  it('còn trong cửa sổ debounce (chuỗi gõ khác chuỗi đã chốt) => chưa sẵn sàng', () => {
    expect(suggestionsReady('dang nhap', 'dang', false)).toBe(false);
    expect(suggestionsReady('d', 'dang nhap', false)).toBe(false);
  });
  it('đang tải hoặc đang hiện kết quả cũ (keepPreviousData) => chưa sẵn sàng', () => {
    expect(suggestionsReady('abc', 'abc', true)).toBe(false);
  });
  it('chuỗi rỗng không bao giờ sẵn sàng', () => {
    expect(suggestionsReady('  ', '', false)).toBe(false);
  });
});
