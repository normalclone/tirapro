import { describe, expect, it, vi } from 'vitest';
import { MutationObserver, QueryClient } from '@tanstack/react-query';

vi.mock('./socket', () => ({ acquireRoom: vi.fn(), getSocket: vi.fn() }));

import { keys } from './queryKeys';
import type { IssueDto } from '@tirapro/types';
import { mk as fixture } from './issueFixture';
import { reactionMutationOptions } from '@/features/issue-edit/commentReactionSave';
import {
  applyCommentChanged,
  applyCommentReaction,
  applyIssueCreated,
  applyIssueUpdated,
  applyRanksRebalanced,
} from './realtime';

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

describe('applyCommentReaction (comment:reaction)', () => {
  it('chỉ nạp lại bình luận của đúng issue (thả cảm xúc không sinh hoạt động)', () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.issues.comments('i1'), []);
    qc.setQueryData(keys.issues.activity('i1'), []);
    qc.setQueryData(keys.issues.comments('i2'), []);
    applyCommentReaction(qc, 'i1');
    expect(qc.getQueryState(keys.issues.comments('i1'))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys.issues.activity('i1'))?.isInvalidated).toBe(false);
    expect(qc.getQueryState(keys.issues.comments('i2'))?.isInvalidated).toBe(false);
  });

  it('bỏ qua khi MÌNH đang có lần thả chờ ở issue đó (tránh chip nháy về bản cũ); lần cuối xong sẽ tự nạp lại', async () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.issues.comments('i1'), [{ id: 'c1', reactions: [] }]);
    let release!: () => void;
    const gate = new Promise<never[]>((res) => {
      release = () => res([]);
    });
    const o = new MutationObserver(
      qc,
      reactionMutationOptions(
        qc,
        'i1',
        () => ({ id: 'me', displayName: 'Tôi' }),
        () => gate,
      ),
    );
    const p = o.mutate({ commentId: 'c1', emoji: '👍', on: true });
    await new Promise((r) => setTimeout(r, 5));
    applyCommentReaction(qc, 'i1');
    expect(qc.getQueryState(keys.issues.comments('i1'))?.isInvalidated).toBe(false);
    release();
    await p;
    expect(qc.getQueryState(keys.issues.comments('i1'))?.isInvalidated).toBe(true); // do onSettled của chính mutation
    applyCommentReaction(qc, 'i2'); // issue khác thì vẫn nạp lại bình thường
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

describe('việc chưa duyệt không vào danh sách realtime (S-I1)', () => {
  const mk = (id: string, over: Partial<IssueDto> = {}) =>
    fixture(id, { projectId: 'p1', key: `A-${id}`, version: 1, triageState: null, ...over });
  const list = (qc: QueryClient) => qc.getQueryData<IssueDto[]>(keys.issues.byProject('p1'));

  it.each(['PENDING', 'SNOOZED', 'DECLINED'] as const)(
    'issue:created với triageState=%s không được chèn',
    (st) => {
      const qc = new QueryClient();
      qc.setQueryData(keys.issues.byProject('p1'), [mk('a')]);
      applyIssueCreated(qc, mk('b', { triageState: st }));
      expect(list(qc)!.map((i) => i.id)).toEqual(['a']);
    },
  );
  it('issue:created thường (triageState null / ACCEPTED) vẫn chèn', () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.issues.byProject('p1'), [mk('a')]);
    applyIssueCreated(qc, mk('b'));
    applyIssueCreated(qc, mk('c', { triageState: 'ACCEPTED' }));
    expect(list(qc)!.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
  it('issue:updated chuyển SANG trạng thái ẩn → gỡ khỏi danh sách dự án và board lọc', () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.issues.byProject('p1'), [mk('a'), mk('b')]);
    qc.setQueryData(keys.issues.byBoard('bd'), [mk('a'), mk('b')]);
    applyIssueUpdated(qc, mk('b', { triageState: 'DECLINED', version: 2 }));
    expect(list(qc)!.map((i) => i.id)).toEqual(['a']);
    expect(qc.getQueryData<IssueDto[]>(keys.issues.byBoard('bd'))!.map((i) => i.id)).toEqual(['a']);
  });
  it('issue:updated trạng thái ẩn mà danh sách chưa có → vẫn không chèn', () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.issues.byProject('p1'), [mk('a')]);
    applyIssueUpdated(qc, mk('b', { triageState: 'PENDING', version: 2 }));
    expect(list(qc)!.map((i) => i.id)).toEqual(['a']);
  });
  it('issue:updated sang ACCEPTED từ trạng thái ẩn (danh sách chưa có) → invalidate, không chèn', () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.issues.byProject('p1'), [mk('a')]);
    applyIssueUpdated(qc, mk('b', { triageState: 'ACCEPTED', version: 3 }));
    expect(list(qc)!.map((i) => i.id)).toEqual(['a']);
    expect(qc.getQueryState(keys.issues.byProject('p1'))?.isInvalidated).toBe(true);
  });
  it('issue:updated bình thường của việc đã có vẫn vá theo version', () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.issues.byProject('p1'), [mk('a', { summary: 'cũ' })]);
    applyIssueUpdated(qc, mk('a', { summary: 'mới', version: 2, triageState: 'ACCEPTED' }));
    expect(list(qc)![0]!.summary).toBe('mới');
    expect(qc.getQueryState(keys.issues.byProject('p1'))?.isInvalidated).toBe(false);
  });
});
