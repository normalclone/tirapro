import type { MutationOptions, QueryClient } from '@tanstack/react-query';
import type { CommentDto, CommentReactionDto } from '@tirapro/types';
import { keys } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { registerSessionCleaner } from '@/lib/sessionCache';
import { applyReaction, putReactionEntry } from './commentReactions';

export interface ReactionVars {
  commentId: string;
  emoji: string;
  /** true = thả (PUT), false = bỏ (DELETE). Đặt TRẠNG THÁI, không "đảo": gửi lại không lật kết quả. */
  on: boolean;
}

const REACTION_MUTATION_KEY = ['comment-reaction', 'set'] as const;

/**
 * Trạng thái theo từng (issue, bình luận, emoji) trong lúc còn lần gửi chạy/xếp hàng — cùng mô hình Task 8:
 * - `confirmed`: bản chip MÁY CHỦ đã xác nhận gần nhất (gieo từ cache trước lần bấm đầu tiên của khoá; cập nhật khi một lần
 *   gửi THÀNH CÔNG, lấy từ phản hồi). Hoàn tác khi lỗi luôn về đây, KHÔNG về ảnh chụp lạc quan (có thể là trạng thái chưa
 *   từng được lưu). `undefined` = chưa ai thả.
 * - `pending`: số lần gửi của khoá chưa xong. Lỗi mà còn lần sau → KHÔNG hoàn tác (lần sau, nối tiếp đúng thứ tự, định đoạt);
 *   chỉ lần cuối còn lại mới hoàn tác về `confirmed`.
 */
interface KeyState {
  confirmed: CommentReactionDto | undefined;
  pending: number;
}
const stateKey = (issueId: string, v: ReactionVars) => `${issueId}|${v.commentId}|${v.emoji}`;
const keyStates = new WeakMap<QueryClient, Map<string, KeyState>>();
const statesOf = (qc: QueryClient): Map<string, KeyState> => {
  let m = keyStates.get(qc);
  if (!m) keyStates.set(qc, (m = new Map<string, KeyState>()));
  return m;
};

/** Đổi phiên (đăng xuất / đổi workspace): lần gửi còn bay giữ bản đồ CŨ trong context nên không ghi vào phiên sau. */
export function resetReactionStates(qc: QueryClient): void {
  keyStates.delete(qc);
}
registerSessionCleaner(() => resetReactionStates(queryClient));

/** Còn lần thả/bỏ nào của issue này đang chờ không — realtime bỏ qua nạp lại giữa chừng để chip không nháy về bản cũ. */
export function hasPendingReactions(qc: QueryClient, issueId: string): boolean {
  const m = keyStates.get(qc);
  if (!m) return false;
  for (const k of m.keys()) if (k.startsWith(`${issueId}|`)) return true;
  return false;
}

interface Ctx {
  states: Map<string, KeyState> | null;
}
const live = (qc: QueryClient, ctx: Ctx | undefined): Map<string, KeyState> | undefined =>
  ctx?.states && keyStates.get(qc) === ctx.states ? ctx.states : undefined;

/** Sửa `reactions` của MỘT bình luận trong cache danh sách (không tạo cache mới, không đụng bình luận khác). */
function patchReactions(
  qc: QueryClient,
  issueId: string,
  commentId: string,
  fn: (list: CommentReactionDto[]) => CommentReactionDto[],
): void {
  qc.setQueryData<CommentDto[]>(keys.issues.comments(issueId), (old) =>
    old?.map((c) => (c.id === commentId ? { ...c, reactions: fn(c.reactions ?? []) } : c)),
  );
}

export interface ReactionSaveEvents {
  onFailed?: (error: unknown, vars: ReactionVars) => void;
}

/**
 * Tuỳ chọn mutation thả/bỏ cảm xúc có cập nhật lạc quan:
 * - `scope`: mọi lần gửi của issue chạy NỐI TIẾP đúng thứ tự bấm → máy chủ nhận lần bấm cuối cuối cùng.
 * - `onSuccess`: ghi chip THẬT từ phản hồi (đếm cả người khác vừa thả) nếu đây là lần cuối của khoá.
 * - `onError`: lần cuối của khoá → về `confirmed`. Toast do hook truyền vào `events().onFailed` (không toast ở đây).
 * - `onSettled`: nạp lại danh sách khi issue hết lần chờ (đồng bộ máy chủ, bắt thay đổi của người khác).
 */
export function reactionMutationOptions(
  qc: QueryClient,
  issueId: string,
  me: () => { id: string; displayName: string } | null,
  send: (v: ReactionVars) => Promise<CommentReactionDto[]>,
  events?: () => ReactionSaveEvents | undefined,
): MutationOptions<CommentReactionDto[], unknown, ReactionVars, Ctx> {
  return {
    mutationKey: REACTION_MUTATION_KEY,
    scope: { id: `comment-reaction:${issueId}` },
    mutationFn: (v) => send(v),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: keys.issues.comments(issueId) });
      const cur = qc.getQueryData<CommentDto[]>(keys.issues.comments(issueId));
      const comment = cur?.find((c) => c.id === v.commentId);
      const who = me();
      if (!comment || !who) return { states: null }; // không tăng pending → onSettled không được trừ
      const states = statesOf(qc);
      const key = stateKey(issueId, v);
      const st = states.get(key) ?? {
        confirmed: comment.reactions?.find((r) => r.emoji === v.emoji),
        pending: 0,
      };
      st.pending += 1;
      states.set(key, st);
      patchReactions(qc, issueId, v.commentId, (list) => applyReaction(list, v.emoji, v.on, who));
      return { states };
    },
    onSuccess: (res, v, ctx) => {
      const states = live(qc, ctx);
      const st = states?.get(stateKey(issueId, v));
      if (!st) return;
      st.confirmed = res.find((r) => r.emoji === v.emoji);
      if (st.pending <= 1)
        patchReactions(qc, issueId, v.commentId, (list) =>
          putReactionEntry(list, v.emoji, st.confirmed),
        );
    },
    onError: (e, v, ctx) => {
      events?.()?.onFailed?.(e, v);
      const st = live(qc, ctx)?.get(stateKey(issueId, v));
      if (!st || st.pending > 1) return; // còn lần sau cho khoá này: nó định đoạt
      patchReactions(qc, issueId, v.commentId, (list) =>
        putReactionEntry(list, v.emoji, st.confirmed),
      );
    },
    onSettled: (_d, _e, v, ctx) => {
      const states = live(qc, ctx);
      if (!states) return;
      const key = stateKey(issueId, v);
      const st = states.get(key);
      if (st) {
        st.pending -= 1;
        if (st.pending <= 0) states.delete(key);
      }
      if (!hasPendingReactions(qc, issueId))
        void qc.invalidateQueries({ queryKey: keys.issues.comments(issueId) });
    },
  };
}
