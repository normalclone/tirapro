import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

vi.mock('./socket', () => ({ acquireRoom: vi.fn(), getSocket: vi.fn() }));

import { keys } from './queryKeys';
import { applyCommentChanged } from './realtime';

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
