import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { CommentDto, CommentReactionDto } from '@tirapro/types';
import { keys } from '@/lib/queryKeys';
import {
  hasPendingReactions,
  reactionMutationOptions,
  resetReactionStates,
  type ReactionVars,
} from './commentReactionSave';

const ME = { id: 'me', displayName: 'Tôi' };
const entry = (
  emoji: string,
  count: number,
  mine: boolean,
  names: string[] = [],
): CommentReactionDto => ({
  emoji,
  count,
  mine,
  users: names.map((n) => ({ id: n === 'Tôi' ? 'me' : `id-${n}`, displayName: n })),
});
const comment = (id: string, reactions: CommentReactionDto[]): CommentDto =>
  ({ id, issueId: 'i1', body: 'x', reactions }) as unknown as CommentDto;

const defer = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setTimeout(r, 5));

function setup(
  send: (v: ReactionVars) => Promise<CommentReactionDto[]>,
  initial: CommentDto[] = [comment('c1', [entry('👍', 2, false, ['An', 'Bình'])])],
  onFailed = vi.fn(),
) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData(keys.issues.comments('i1'), initial);
  const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
  const run = (v: ReactionVars) => {
    const o = new MutationObserver(
      qc,
      reactionMutationOptions(
        qc,
        'i1',
        () => ME,
        send,
        () => ({ onFailed }),
      ),
    );
    return o.mutate(v).catch(() => undefined);
  };
  const reactions = (id = 'c1') =>
    qc.getQueryData<CommentDto[]>(keys.issues.comments('i1'))!.find((c) => c.id === id)!.reactions!;
  return { qc, run, reactions, invalidate, onFailed };
}

describe('reactionMutationOptions — lạc quan, nối tiếp, hoàn tác về bản máy chủ xác nhận', () => {
  it('cập nhật cache NGAY trước khi máy chủ trả lời; xong thì ghi bản máy chủ (đếm cả người khác) và nạp lại', async () => {
    const d = defer<CommentReactionDto[]>();
    const { run, reactions, invalidate, qc } = setup(() => d.promise);
    const p = run({ commentId: 'c1', emoji: '👍', on: true });
    await tick();
    expect(reactions()).toEqual([entry('👍', 3, true, ['An', 'Bình', 'Tôi'])]);
    expect(hasPendingReactions(qc, 'i1')).toBe(true);
    // máy chủ: trong lúc đó có thêm một người khác thả → số thật là 4
    d.resolve([entry('👍', 4, true, ['An', 'Bình', 'Tôi', 'Cường'])]);
    await p;
    expect(reactions()).toEqual([entry('👍', 4, true, ['An', 'Bình', 'Tôi', 'Cường'])]);
    expect(hasPendingReactions(qc, 'i1')).toBe(false);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('lỗi: hoàn tác về bản XÁC NHẬN lúc gieo (không phải ảnh chụp lạc quan), báo lỗi qua callback của hook', async () => {
    const { run, reactions, onFailed } = setup(() => Promise.reject(new Error('500')));
    await run({ commentId: 'c1', emoji: '👍', on: true });
    expect(reactions()).toEqual([entry('👍', 2, false, ['An', 'Bình'])]);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed.mock.calls[0]![1]).toEqual({ commentId: 'c1', emoji: '👍', on: true });
  });

  it('bấm bật rồi bỏ nhanh (hai lần liên tiếp): gửi NỐI TIẾP đúng thứ tự; lần 1 lỗi KHÔNG hoàn tác vì lần 2 còn chờ; cuối cùng về trạng thái lần 2', async () => {
    const order: string[] = [];
    const gates = [defer<CommentReactionDto[]>(), defer<CommentReactionDto[]>()];
    let n = 0;
    const { run, reactions } = setup(async (v) => {
      const i = n++;
      order.push(`start${i}:${v.on}`);
      return gates[i]!.promise;
    });
    const p1 = run({ commentId: 'c1', emoji: '👍', on: true });
    const p2 = run({ commentId: 'c1', emoji: '👍', on: false });
    await tick();
    expect(order).toEqual(['start0:true']); // lần hai chờ lần một
    expect(reactions()).toEqual([entry('👍', 2, false, ['An', 'Bình'])]); // bật rồi bỏ = như cũ
    gates[0]!.reject(new Error('500'));
    await tick();
    expect(order).toEqual(['start0:true', 'start1:false']);
    expect(reactions()).toEqual([entry('👍', 2, false, ['An', 'Bình'])]); // không nháy về bản nào khác
    gates[1]!.resolve([entry('👍', 2, false, ['An', 'Bình'])]);
    await Promise.all([p1, p2]);
    expect(reactions()).toEqual([entry('👍', 2, false, ['An', 'Bình'])]);
  });

  it('hai lần liên tiếp, lần cuối lỗi: hoàn tác về bản máy chủ xác nhận sau lần ĐẦU thành công (không về bản gieo)', async () => {
    const gates = [defer<CommentReactionDto[]>(), defer<CommentReactionDto[]>()];
    let n = 0;
    const { run, reactions } = setup(() => gates[n++]!.promise);
    const p1 = run({ commentId: 'c1', emoji: '👍', on: true });
    const p2 = run({ commentId: 'c1', emoji: '👍', on: false });
    await tick();
    gates[0]!.resolve([entry('👍', 3, true, ['An', 'Bình', 'Tôi'])]); // lần 1 xong: máy chủ xác nhận mine
    await tick();
    gates[1]!.reject(new Error('500')); // lần 2 (bỏ) lỗi
    await Promise.all([p1, p2]);
    expect(reactions()).toEqual([entry('👍', 3, true, ['An', 'Bình', 'Tôi'])]);
  });

  it('một emoji lỗi không xoá cập nhật lạc quan của emoji khác trên cùng bình luận', async () => {
    const gates = [defer<CommentReactionDto[]>(), defer<CommentReactionDto[]>()];
    let n = 0;
    const { run, reactions } = setup(() => gates[n++]!.promise);
    const p1 = run({ commentId: 'c1', emoji: '👍', on: true });
    const p2 = run({ commentId: 'c1', emoji: '🎉', on: true });
    await tick();
    gates[0]!.reject(new Error('500'));
    await tick();
    // 👍 về bản xác nhận (2 người, chưa có mình); 🎉 vẫn lạc quan (đang chờ gửi)
    expect(reactions()).toEqual([
      entry('👍', 2, false, ['An', 'Bình']),
      entry('🎉', 1, true, ['Tôi']),
    ]);
    gates[1]!.resolve([entry('🎉', 1, true, ['Tôi'])]);
    await Promise.all([p1, p2]);
  });

  it('thả emoji chưa từng có rồi lỗi: chip biến mất (xác nhận = chưa có)', async () => {
    const { run, reactions } = setup(() => Promise.reject(new Error('500')), [comment('c1', [])]);
    await run({ commentId: 'c1', emoji: '🎉', on: true });
    expect(reactions()).toEqual([]);
  });

  it('bỏ cảm xúc rồi lỗi: chip trở lại đúng bản đã xác nhận', async () => {
    const { run, reactions } = setup(
      () => Promise.reject(new Error('500')),
      [comment('c1', [entry('👍', 1, true, ['Tôi'])])],
    );
    await run({ commentId: 'c1', emoji: '👍', on: false });
    expect(reactions()).toEqual([entry('👍', 1, true, ['Tôi'])]);
  });

  it('chỉ nạp lại khi lần cuối của bình luận xong (không nạp giữa chừng làm chip nháy)', async () => {
    const gates = [defer<CommentReactionDto[]>(), defer<CommentReactionDto[]>()];
    let n = 0;
    const { run, invalidate } = setup(() => gates[n++]!.promise);
    const p1 = run({ commentId: 'c1', emoji: '👍', on: true });
    const p2 = run({ commentId: 'c1', emoji: '🎉', on: true });
    await tick();
    gates[0]!.resolve([entry('👍', 3, true, ['An', 'Bình', 'Tôi'])]);
    await tick();
    expect(invalidate).not.toHaveBeenCalled();
    gates[1]!.resolve([entry('🎉', 1, true, ['Tôi'])]);
    await Promise.all([p1, p2]);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('cache chưa có / bình luận không có trong cache: vẫn gửi, không ném lỗi, không tăng pending', async () => {
    const send = vi.fn().mockResolvedValue([]);
    const { run, qc } = setup(send, []);
    await run({ commentId: 'zzz', emoji: '👍', on: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(hasPendingReactions(qc, 'i1')).toBe(false);
  });

  it('đổi phiên (resetReactionStates): lần lưu muộn của phiên cũ không ghi vào cache phiên mới', async () => {
    const d = defer<CommentReactionDto[]>();
    const { run, reactions, qc } = setup(() => d.promise);
    const p = run({ commentId: 'c1', emoji: '👍', on: true });
    await tick();
    resetReactionStates(qc);
    qc.setQueryData(keys.issues.comments('i1'), [comment('c1', [entry('👀', 1, false, ['Z'])])]);
    d.reject(new Error('500'));
    await p;
    expect(reactions()).toEqual([entry('👀', 1, false, ['Z'])]); // không bị "hoàn tác" của phiên cũ
  });
});
