import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

vi.mock('./socket', () => ({ acquireRoom: vi.fn(), getSocket: vi.fn() }));

import { keys } from './queryKeys';
import { applyCommentChanged, applyRanksRebalanced } from './realtime';

describe('applyCommentChanged', () => {
  it('invalidate bình luận + hoạt động của đúng issue', () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.issues.comments('i1'), []);
    qc.setQueryData(keys.issues.activity('i1'), []);
    qc.setQueryData(keys.issues.comments('i2'), []);
    applyCommentChanged(qc, 'i1');
    expect(qc.getQueryState(keys.issues.comments('i1'))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys.issues.activity('i1'))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys.issues.comments('i2'))?.isInvalidated).toBe(false);
  });
});

describe('applyRanksRebalanced', () => {
  it('invalidate danh sách dự án và chi tiết issue của đúng dự án, giữ nguyên dự án khác', () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.issues.byProject('p1'), [{ id: 'i1' }]);
    qc.setQueryData(keys.issues.byProject('p2'), [{ id: 'i2' }]);
    qc.setQueryData(keys.issues.byKey('A-1'), { id: 'i1', projectId: 'p1' });
    qc.setQueryData(keys.issues.byKey('B-1'), { id: 'i2', projectId: 'p2' });
    applyRanksRebalanced(qc, 'p1');
    expect(qc.getQueryState(keys.issues.byProject('p1'))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys.issues.byKey('A-1'))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys.issues.byProject('p2'))?.isInvalidated).toBe(false);
    expect(qc.getQueryState(keys.issues.byKey('B-1'))?.isInvalidated).toBe(false);
  });

  it('cache board có bộ lọc: chỉ invalidate board chứa việc của đúng dự án', () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.issues.byBoard('b1'), [{ id: 'i1', projectId: 'p1' }]);
    qc.setQueryData(keys.issues.byBoard('b2'), [{ id: 'i2', projectId: 'p2' }]);
    qc.setQueryData(keys.issues.byBoard('b3'), []); // board rỗng: không có rank nào để cũ
    applyRanksRebalanced(qc, 'p1');
    expect(qc.getQueryState(keys.issues.byBoard('b1'))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys.issues.byBoard('b2'))?.isInvalidated).toBe(false);
    expect(qc.getQueryState(keys.issues.byBoard('b3'))?.isInvalidated).toBe(false);
  });
});
