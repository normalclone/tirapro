import { labelKey, normalizeLabelName } from './labelCombo';

interface LabelRef {
  id: string;
  name: string;
  color: string | null;
}

/** Cách gọi API của "tạo nhãn khi gắn" — truyền vào để hàm thuần test được không cần mạng. */
export interface CreateAttachDeps {
  createLabel: (v: { name: string; color: string }) => Promise<LabelRef>;
  listLabels: () => Promise<LabelRef[]>;
  attach: (labelId: string) => Promise<unknown>;
}

/** Nhãn đã có (mới tạo, hoặc có sẵn do trùng tên) nhưng bước GẮN vào việc lỗi. Nhãn vẫn nằm trong danh sách của dự án. */
export class AttachAfterCreateError extends Error {
  constructor(
    readonly label: LabelRef,
    override readonly cause: unknown,
  ) {
    super('Đã có nhãn nhưng chưa gắn được vào việc');
    this.name = 'AttachAfterCreateError';
  }
}

/**
 * Tạo nhãn rồi gắn vào việc. Tên được chuẩn hoá (`normalizeLabelName`) trước khi gửi.
 * - Tạo lỗi: tra lại danh sách nhãn; có nhãn trùng tên (khác hoa/thường/dấu — vd người khác vừa tạo) thì gắn nhãn CÓ SẴN;
 *   không có (hoặc không tra được) thì ném LẠI lỗi gốc của bước tạo.
 * - Bước gắn lỗi → `AttachAfterCreateError` (kèm nhãn và lỗi gốc) để nơi gọi báo đúng giai đoạn.
 */
export async function createAndAttachLabel(
  deps: CreateAttachDeps,
  input: { name: string; color: string },
): Promise<LabelRef> {
  const name = normalizeLabelName(input.name);
  let label: LabelRef;
  try {
    label = await deps.createLabel({ name, color: input.color });
  } catch (e) {
    const list = await deps.listLabels().catch(() => null);
    const found = list?.find((l) => labelKey(l.name) === labelKey(name));
    if (!found) throw e;
    label = found;
  }
  try {
    await deps.attach(label.id);
  } catch (e) {
    throw new AttachAfterCreateError(label, e);
  }
  return label;
}

/** Câu báo lỗi theo giai đoạn: tạo lỗi, hoặc đã tạo/có sẵn nhưng gắn lỗi. `messageOf` rút câu từ lỗi gốc (apiErrorMessage). */
export function labelCreateErrorMessage(
  e: unknown,
  name: string,
  messageOf: (e: unknown) => string,
): string {
  return e instanceof AttachAfterCreateError
    ? `Đã tạo nhãn “${name}” nhưng chưa gắn được: ${messageOf(e.cause)}`
    : `Chưa tạo được nhãn “${name}”: ${messageOf(e)}`;
}
