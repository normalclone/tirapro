import type { SearchSelectOption } from '@/components/ui/SearchSelect';
import { LABEL_PALETTE, colorKey, labelTone } from '@/lib/labelPalette';

/**
 * Logic thuần của ô nhãn (`IssueLabelsPicker`): so tên, đề nghị "Tạo nhãn", danh sách lựa chọn, màu nhãn mới và máy
 * trạng thái "Backspace hai lần gỡ chip cuối".
 */

/** Giới hạn tên nhãn của API (`createLabelSchema`: tối đa 50 ký tự sau khi cắt khoảng trắng). */
export const LABEL_NAME_MAX = 50;

/** `value` của dòng "Tạo nhãn “X”" trong danh sách (không bao giờ trùng id nhãn thật). */
export const CREATE_VALUE = '__create-label__';

/**
 * Khoá so tên nhãn: hạ chữ thường, bỏ dấu tiếng Việt (đ → d), gộp khoảng trắng. KHÔNG đổi dấu gạch nối/gạch dưới — API
 * chỉ chặn trùng đúng chuỗi, ta chặn thêm trùng "chỉ khác hoa/thường hoặc dấu" nhưng không gộp `tech-debt` với `tech debt`.
 */
export function labelKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .trim()
    .replace(/\s+/g, ' ');
}

interface LabelLike {
  id: string;
  name: string;
  color: string | null;
}

/**
 * Tên nhãn gửi lên API: NFC (dấu gõ rời/dựng sẵn như nhau), cắt hai đầu, gộp mọi khoảng trắng liên tiếp thành một dấu cách.
 * Cùng quan niệm "như nhau" với `labelKey`, nên nhãn sinh ra không bao giờ khác nhãn có sẵn chỉ ở những điểm này.
 */
export function normalizeLabelName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ');
}

export type CreateOffer =
  | { kind: 'none' }
  /** Có thể tạo nhãn mới `name` ngay (có quyền + chưa có nhãn trùng). */
  | { kind: 'create'; name: string }
  | { kind: 'noPermission' }
  | { kind: 'tooLong' }
  /** Đã có nhãn cùng tên (khác hoa/thường/dấu): chọn nhãn đó, không tạo trùng. */
  | { kind: 'exists'; labelId: string; attached: boolean };

/**
 * Với chữ đang gõ, ô nhãn nên đề nghị gì. Thứ tự: trống → đã có nhãn trùng (kể cả không có quyền — chọn nhãn có sẵn)
 * → quá dài → không có quyền → tạo. `labels` là MỌI nhãn của dự án (kể cả đã gắn vào việc này).
 */
export function createOffer(input: {
  q: string;
  labels: readonly LabelLike[];
  attachedIds: ReadonlySet<string>;
  canCreate: boolean;
}): CreateOffer {
  const name = normalizeLabelName(input.q);
  if (name === '') return { kind: 'none' };
  const key = labelKey(name);
  const same = input.labels.find((l) => labelKey(l.name) === key);
  if (same) return { kind: 'exists', labelId: same.id, attached: input.attachedIds.has(same.id) };
  if (name.length > LABEL_NAME_MAX) return { kind: 'tooLong' };
  if (!input.canCreate) return { kind: 'noPermission' };
  return { kind: 'create', name };
}

/** Dòng ghim cuối danh sách theo đề nghị: "Tạo nhãn “X”" (chọn được) hoặc câu giải thích (không chọn được). */
export function pinnedRows(offer: CreateOffer): SearchSelectOption[] {
  switch (offer.kind) {
    case 'create':
      return [{ value: CREATE_VALUE, label: `Tạo nhãn “${offer.name}”` }];
    case 'noPermission':
      return [{ value: '__no-permission__', label: 'Nhờ quản trị dự án tạo nhãn', disabled: true }];
    case 'tooLong':
      return [
        {
          value: '__too-long__',
          label: `Tên nhãn tối đa ${LABEL_NAME_MAX} ký tự`,
          disabled: true,
        },
      ];
    case 'exists':
      return offer.attached
        ? [{ value: '__attached__', label: 'Nhãn này đã gắn vào việc', disabled: true }]
        : [];
    default:
      return [];
  }
}

/**
 * Dòng giải thích khi danh sách rỗng và chưa gõ gì: dự án chưa có nhãn / đã gắn hết; người có quyền được mời gõ tên để tạo.
 * Có nhãn chưa gắn → không cần dòng nào.
 */
export function emptyRows(
  total: number,
  available: number,
  canCreate: boolean,
): SearchSelectOption[] {
  if (available > 0) return [];
  const base = total === 0 ? 'Dự án chưa có nhãn nào.' : 'Đã gắn hết nhãn.';
  return [
    {
      value: '__empty__',
      label: canCreate ? `${base} Gõ tên để tạo nhãn mới.` : base,
      disabled: true,
    },
  ];
}

/**
 * Lựa chọn của ô nhãn: nhãn CHƯA gắn, chấm màu qua token (`labelTone`). Nhãn trùng tên chính xác với chữ đang gõ đứng đầu —
 * ô tìm trỏ mục đầu tiên nên Enter chọn đúng nhãn đó, không phải nhãn khớp một phần.
 */
export function labelOptions(
  labels: readonly LabelLike[],
  attachedIds: ReadonlySet<string>,
  q: string,
): SearchSelectOption[] {
  const key = labelKey(q);
  const rows = labels
    .filter((l) => !attachedIds.has(l.id))
    .map((l) => ({
      option: { value: l.id, label: l.name, color: labelTone(l.color).fg },
      exact: key !== '' && labelKey(l.name) === key,
    }));
  return [...rows.filter((r) => r.exact), ...rows.filter((r) => !r.exact)].map((r) => r.option);
}

/**
 * Màu của nhãn tạo nhanh: màu đầu tiên của `LABEL_PALETTE` mà CHƯA nhãn nào trong dự án dùng (so không phân biệt hoa/thường;
 * màu cũ ngoài bảng không tính). Dùng hết 8 màu thì quay vòng theo số nhãn hiện có.
 */
export function nextLabelColor(labels: readonly { color: string | null }[]): string {
  const used = new Set(labels.map((l) => colorKey(l.color, 'hex')));
  const free = LABEL_PALETTE.find((e) => !used.has(colorKey(e.hex, 'hex')));
  return (free ?? LABEL_PALETTE[labels.length % LABEL_PALETTE.length]!).hex;
}

export interface PendingState {
  /** Chip đang "chờ gỡ" (Backspace lần 1). */
  pendingId: string | null;
}

export type PendingAction =
  | {
      type: 'backspace';
      query: string;
      chipIds: readonly string[];
      /** Phím đang giữ lặp (`e.repeat`). */
      repeat?: boolean;
      /** Đang gỡ một chip dở (chờ máy chủ). */
      busy?: boolean;
    }
  | { type: 'key'; key: string }
  | { type: 'input' }
  | { type: 'close' }
  | { type: 'chips'; chipIds: readonly string[] };

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

/**
 * "Backspace hai lần gỡ chip cuối": ở ô TRỐNG, lần 1 đánh dấu chip cuối là chờ gỡ, lần 2 gỡ đúng chip đó. Phím khác
 * (trừ phím bổ trợ đơn lẻ), gõ chữ, đóng popup, hoặc chip chờ biến mất → xoá trạng thái chờ. Ô có chữ: Backspace là
 * xoá chữ (không `handled`). `remove` = id chip cần gỡ; `handled` = nơi gọi nên `preventDefault`.
 */
export function reducePending(
  state: PendingState,
  action: PendingAction,
): { state: PendingState; remove: string | null; handled: boolean } {
  const idle = { pendingId: null };
  switch (action.type) {
    case 'backspace': {
      if (action.query !== '' || action.chipIds.length === 0)
        return { state: idle, remove: null, handled: false };
      // Giữ phím / đang gỡ dở: nuốt phím để không gỡ liên tiếp (DELETE đôi, toast đôi); trạng thái giữ nguyên.
      if (action.repeat || action.busy) return { state, remove: null, handled: true };
      const pending = state.pendingId;
      if (pending !== null && action.chipIds.includes(pending))
        return { state: idle, remove: pending, handled: true };
      return {
        state: { pendingId: action.chipIds[action.chipIds.length - 1]! },
        remove: null,
        handled: true,
      };
    }
    case 'key':
      return MODIFIER_KEYS.has(action.key)
        ? { state, remove: null, handled: false }
        : { state: idle, remove: null, handled: false };
    case 'chips':
      return {
        state: state.pendingId !== null && action.chipIds.includes(state.pendingId) ? state : idle,
        remove: null,
        handled: false,
      };
    default:
      return { state: idle, remove: null, handled: false };
  }
}

/** Lời báo (vùng `role="status"`) khi một chip vào trạng thái chờ gỡ. */
export function pendingAnnouncement(name: string): string {
  return `Nhấn Backspace lần nữa để gỡ nhãn ${name}`;
}
