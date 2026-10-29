import { buildQuickAddInput, isEpicType, pickDefaultType } from '@/features/issues/quickAdd';
import { unmatchedHint, unmatchedTokens, type TokenCtx } from '@/features/issues/titleTokens';
import type { CreateIssueInput } from '@/features/issues/create-api';
import { normalizeVi } from '@/lib/text';
import type { TypeHint } from './intents';

/**
 * Thẻ NHÁP tạo việc: dựng từ câu lệnh + cấu hình dự án (loại, ưu tiên, thành viên, sprint — cùng nguồn với hộp tạo việc),
 * dùng CÙNG parser token `! @ # ~ ^` (`buildQuickAddInput`). Thuần hàm: dựng nháp KHÔNG tạo gì — chỉ `confirmDraft`
 * (respond.ts), sau khi người dùng bấm "Tạo", mới gọi mutation.
 */
export interface DraftMeta {
  issueTypes: {
    id: string;
    name: string;
    key: string | null;
    isSubtask: boolean;
    hierarchyLevel?: number;
  }[];
  priorities: { id: string; name: string; rank?: number; isDefault?: boolean }[];
}

export interface Draft {
  projectId: string;
  projectKey: string;
  projectName: string;
  typeId: string;
  typeName: string;
  /** Câu báo khi không có loại việc người dùng nhắc tới (vd "bug" nhưng dự án không có loại Bug). */
  typeNote?: string;
  summary: string;
  priority?: { id: string; name: string };
  assignee?: { id: string; name: string };
  sprint?: { id: string; name: string };
  points?: number;
  /** ISO. */
  due?: string;
  /** Token KHÔNG khớp (vẫn nằm trong tiêu đề) — cảnh báo như hộp tạo việc. */
  unmatched: string[];
  unmatchedHint: string;
  /** Chữ gõ sau câu lệnh (giữ nguyên token) — để mở form đầy đủ điền sẵn. */
  rawText: string;
  /** Đúng payload sẽ gửi khi bấm Tạo. */
  input: CreateIssueInput;
}

export interface DraftArgs {
  /** Phần sau câu lệnh ("Sửa lỗi login !cao @an ^mai"). */
  text: string;
  typeHint: TypeHint;
  project: { id: string; key: string; name: string };
  meta: DraftMeta;
  users: TokenCtx['users'];
  sprints: TokenCtx['sprints'];
}

const nf = (s: string | null | undefined) => normalizeVi(s ?? '');

/** Chọn loại việc theo gợi ý; không có loại tương ứng thì loại mặc định kèm câu báo. */
export function pickType(
  types: DraftMeta['issueTypes'],
  hint: TypeHint,
): { id: string; note?: string } {
  const usable = types.filter((t) => !t.isSubtask);
  const find = (pred: (t: DraftMeta['issueTypes'][number]) => boolean) => usable.find(pred)?.id;
  const defaultId = () => find((t) => t.key === 'TASK') ?? pickDefaultType(types, null);
  if (!hint) return { id: defaultId() };
  const hit =
    hint === 'bug'
      ? (find((t) => t.key === 'BUG') ?? find((t) => /(^| )(bug|loi)( |$)/.test(nf(t.name))))
      : hint === 'story'
        ? (find((t) => t.key === 'STORY') ?? find((t) => /story/.test(nf(t.name))))
        : (find((t) => t.key === 'EPIC') ?? find((t) => isEpicType(t)));
  if (hit) return { id: hit };
  const label = { bug: 'Bug', story: 'Story', epic: 'Epic' }[hint];
  return { id: defaultId(), note: `Dự án chưa có loại ${label} — dùng loại mặc định.` };
}

/** Dựng nháp; `null` khi tiêu đề (sau khi bỏ token) rỗng — trợ lý hỏi lại thay vì dựng thẻ trống. */
export function buildDraft(a: DraftArgs): Draft | null {
  const type = pickType(a.meta.issueTypes, a.typeHint);
  const typeDto = a.meta.issueTypes.find((t) => t.id === type.id);
  if (!typeDto) return null;
  const ctx: TokenCtx = { priorities: a.meta.priorities, users: a.users, sprints: a.sprints };
  const built = buildQuickAddInput(a.text, ctx, {
    projectId: a.project.id,
    typeId: type.id,
    typeIsEpic: isEpicType(typeDto),
  });
  if (!built) return null;
  const { input, unmatched } = built;
  const unmatchedKinds = unmatchedTokens(a.text, ctx);
  const find = <T extends { id: string }>(list: T[], id: string | null | undefined) =>
    id ? list.find((x) => x.id === id) : undefined;
  const pr = find(a.meta.priorities, input.priorityId);
  const as = find(a.users, input.assigneeId);
  const sp = find(a.sprints, input.sprintId);
  return {
    projectId: a.project.id,
    projectKey: a.project.key,
    projectName: a.project.name,
    typeId: type.id,
    typeName: typeDto.name,
    ...(type.note ? { typeNote: type.note } : {}),
    summary: input.summary,
    ...(pr ? { priority: { id: pr.id, name: pr.name } } : {}),
    ...(as ? { assignee: { id: as.id, name: as.displayName } } : {}),
    ...(sp ? { sprint: { id: sp.id, name: sp.name } } : {}),
    ...(input.storyPoints != null ? { points: input.storyPoints } : {}),
    ...(input.dueDate ? { due: input.dueDate } : {}),
    unmatched,
    unmatchedHint: unmatchedHint(unmatchedKinds),
    rawText: a.text.trim(),
    input,
  };
}
