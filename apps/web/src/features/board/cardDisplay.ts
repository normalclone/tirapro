/**
 * Tuỳ chọn hiển thị thẻ trên Bảng việc — sở thích CÁ NHÂN (localStorage theo người dùng + bảng), không đụng API/DB.
 * Module thuần: parse/gộp mặc định/bật-tắt/đọc-ghi storage, không phụ thuộc React.
 * Mã việc và tiêu đề luôn hiện nên KHÔNG nằm trong `CARD_FIELDS`.
 */

export type CardDensity = 'normal' | 'compact';

export const CARD_DENSITIES: readonly { value: CardDensity; label: string }[] = [
  { value: 'normal', label: 'Thường' },
  { value: 'compact', label: 'Gọn' },
];

/** Trường tắt/bật được, theo thứ tự hiện trong popover. */
export const CARD_FIELDS = [
  { id: 'assignee', label: 'Người phụ trách' },
  { id: 'points', label: 'Điểm' },
  { id: 'due', label: 'Hạn' },
  { id: 'labels', label: 'Nhãn' },
  { id: 'priority', label: 'Ưu tiên' },
  { id: 'progress', label: 'Tiến độ việc con' },
] as const;

export type CardFieldId = (typeof CARD_FIELDS)[number]['id'];

export interface CardDisplay {
  readonly density: CardDensity;
  readonly fields: Readonly<Record<CardFieldId, boolean>>;
}

const DEFAULT_FIELDS = Object.freeze(
  Object.fromEntries(CARD_FIELDS.map((f) => [f.id, true])) as Record<CardFieldId, boolean>,
);

/** Giao diện thẻ như trước khi có tuỳ chọn. Tham chiếu duy nhất: kết quả bằng mặc định luôn trả đúng đối tượng này. */
export const DEFAULT_CARD_DISPLAY: CardDisplay = Object.freeze({
  density: 'normal',
  fields: DEFAULT_FIELDS,
});

export function isDefaultDisplay(d: CardDisplay): boolean {
  return d.density === 'normal' && CARD_FIELDS.every((f) => d.fields[f.id] === true);
}

/** Trả về đối tượng mặc định (cùng tham chiếu) khi `d` bằng mặc định — giữ giá trị context ổn định. */
const canonical = (d: CardDisplay): CardDisplay => (isDefaultDisplay(d) ? DEFAULT_CARD_DISPLAY : d);

const isDensity = (v: unknown): v is CardDensity => v === 'normal' || v === 'compact';

/**
 * Chuỗi thô → tuỳ chọn. Hỏng/sai kiểu → mặc định; trường không nhắc tới hoặc sai kiểu lấy mặc định của trường đó
 * (nên trường mới thêm về sau tự có mặc định); trường lạ bị bỏ.
 */
export function parseCardDisplay(raw: string | null): CardDisplay {
  if (!raw) return DEFAULT_CARD_DISPLAY;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_CARD_DISPLAY;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return DEFAULT_CARD_DISPLAY;
  const obj = data as { density?: unknown; fields?: unknown };
  const stored =
    obj.fields && typeof obj.fields === 'object' && !Array.isArray(obj.fields)
      ? (obj.fields as Record<string, unknown>)
      : {};
  const fields = { ...DEFAULT_FIELDS };
  for (const f of CARD_FIELDS) {
    const v = stored[f.id];
    if (typeof v === 'boolean') fields[f.id] = v;
  }
  return canonical({ density: isDensity(obj.density) ? obj.density : 'normal', fields });
}

/** Chỉ lưu phần KHÁC mặc định (để mặc định đổi về sau vẫn có hiệu lực); mặc định → null = xoá khoá. */
export function serializeCardDisplay(d: CardDisplay): string | null {
  if (isDefaultDisplay(d)) return null;
  const fields: Partial<Record<CardFieldId, boolean>> = {};
  for (const f of CARD_FIELDS)
    if (d.fields[f.id] !== DEFAULT_FIELDS[f.id]) fields[f.id] = d.fields[f.id];
  return JSON.stringify({ v: 1, density: d.density, fields });
}

export function setDensity(d: CardDisplay, density: CardDensity): CardDisplay {
  return d.density === density ? d : canonical({ ...d, density });
}

export function toggleField(d: CardDisplay, id: CardFieldId): CardDisplay {
  return canonical({ ...d, fields: { ...d.fields, [id]: !d.fields[id] } });
}

/** Lớp bố cục theo mật độ. `normal` giữ NGUYÊN các class của thẻ trước khi có tuỳ chọn. Chỉ dùng token khoảng cách của Tailwind. */
export interface CardLayout {
  /** Đệm thẻ. */
  pad: string;
  /** Khoảng cách dưới mỗi dòng. */
  gap: string;
  /** Số dòng tiêu đề. */
  title: string;
  /** Khoảng cách trên của thanh tiến độ. */
  progressTop: string;
  /** Số nhãn tối đa trước khi gộp thành "+n". */
  labelMax: number;
}

const LAYOUT: Record<CardDensity, CardLayout> = {
  normal: {
    pad: 'p-2.5',
    gap: 'mb-1.5',
    title: 'line-clamp-2',
    progressTop: 'mt-2',
    labelMax: 3,
  },
  compact: {
    pad: 'p-2',
    gap: 'mb-1',
    title: 'line-clamp-1',
    progressTop: 'mt-1.5',
    labelMax: 2,
  },
};

export const cardLayout = (density: CardDensity): CardLayout => LAYOUT[density];

/* ---------------------------------- storage --------------------------------- */

export type CardDisplayStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const cardDisplayKey = (userId: string, boardId: string) =>
  `tirapro:boardDisplay:v1:${userId}:${boardId}`;

/** `localStorage` được chạm BÊN TRONG try: khi trình duyệt chặn dữ liệu site, chỉ việc đọc `window.localStorage` đã ném. */
function resolve(storage: CardDisplayStorage | null | undefined): CardDisplayStorage | null {
  if (storage !== undefined) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Chuỗi thô trong storage (hoặc null); mọi lỗi storage → null. */
export function readCardDisplayRaw(
  key: string | null,
  storage?: CardDisplayStorage | null,
): string | null {
  if (!key) return null;
  try {
    return resolve(storage)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function readCardDisplay(
  key: string | null,
  storage?: CardDisplayStorage | null,
): CardDisplay {
  return parseCardDisplay(readCardDisplayRaw(key, storage));
}

export function writeCardDisplay(
  key: string,
  d: CardDisplay,
  storage?: CardDisplayStorage | null,
): void {
  try {
    const st = resolve(storage);
    if (!st) return;
    const raw = serializeCardDisplay(d);
    if (raw === null) st.removeItem(key);
    else st.setItem(key, raw);
  } catch {
    /* storage bị chặn: lựa chọn chỉ có hiệu lực trong phiên (xem useCardDisplay) */
  }
}
