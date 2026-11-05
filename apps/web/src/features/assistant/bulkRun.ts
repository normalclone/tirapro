import type {
  AssistantBulkAssignResult,
  AssistantBulkAssignRowInput,
  AssistantBulkMemberRowInput,
  AssistantBulkMembersResult,
} from '@tirapro/types';
import { api } from '@/lib/api';
import {
  assignInputs,
  assignOutcome,
  computeAssign,
  computeMembers,
  memberInputs,
  membersOutcome,
  undoOutcome,
  type AssignState,
  type BulkCard,
  type BulkOutcome,
  type BulkUndo,
  type MemberState,
} from './bulkPreview';

/** Hai lời gọi GHI duy nhất của lệnh hàng loạt. Máy chủ kiểm quyền + phiên bản từng dòng (web không được tin). */
export interface BulkExecutor {
  assign(rows: AssistantBulkAssignRowInput[]): Promise<AssistantBulkAssignResult>;
  members(rows: AssistantBulkMemberRowInput[]): Promise<AssistantBulkMembersResult>;
}

/** Bộ thực thi thật (API `/assistant/bulk/*`). */
export const apiExecutor: BulkExecutor = {
  assign: async (rows) =>
    (await api.post<AssistantBulkAssignResult>('/assistant/bulk/assign', { rows })).data,
  members: async (rows) =>
    (await api.post<AssistantBulkMembersResult>('/assistant/bulk/members', { rows })).data,
};

/**
 * Thực hiện sau khi người dùng bấm Xác nhận. Tính lại từ thẻ + lựa chọn hiện tại (không tin dữ liệu nơi khác), TỪ CHỐI nếu
 * chưa xác nhận được (còn tên mơ hồ, lỗi chặn…), và chỉ gửi các dòng `ok` — dòng bị bỏ, không đủ quyền, "đã đúng" KHÔNG BAO
 * GIỜ được gửi. Trả kết quả từng dòng + dữ liệu Hoàn tác (chỉ của dòng đã đổi thật).
 */
export async function runConfirm(
  card: BulkCard,
  state: AssignState | MemberState,
  exec: BulkExecutor,
): Promise<BulkOutcome> {
  if (card.kind === 'assign') {
    const computed = computeAssign(card, state as AssignState);
    if (!computed.canConfirm) throw new Error('Lệnh chưa đủ điều kiện để xác nhận.');
    const sent = computed.rows.filter((r) => r.status === 'ok');
    return assignOutcome(sent, await exec.assign(assignInputs(computed)));
  }
  const computed = computeMembers(card, state as MemberState);
  if (!computed.canConfirm) throw new Error('Lệnh chưa đủ điều kiện để xác nhận.');
  const sent = computed.rows.filter((r) => r.status === 'ok');
  return membersOutcome(card, sent, await exec.members(memberInputs(card, computed)));
}

/** Hoàn tác: gửi đúng các yêu cầu đảo ngược đã lưu. Dòng bị người khác sửa sau đó máy chủ bỏ qua (và báo). */
export async function runUndo(undo: BulkUndo, exec: BulkExecutor): Promise<BulkOutcome> {
  return undoOutcome(
    undo,
    undo.kind === 'assign' ? await exec.assign(undo.rows) : await exec.members(undo.rows),
  );
}
