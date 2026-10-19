import { isImageMime } from '@/features/attachments/ref';

/** Giới hạn mặc định của server (`MAX_FILE_SIZE_MB`): chặn sớm ở trình duyệt để báo rõ thay vì chờ tải rồi lỗi. */
export const MAX_PASTE_BYTES = 25 * 1024 * 1024;

export const isTooLarge = (f: Pick<File, 'size'>): boolean => f.size > MAX_PASTE_BYTES;

/** Chỉ ảnh an toàn (không SVG) trong tệp của clipboard. */
export const imageFilesFromClipboard = (files: File[]): File[] =>
  files.filter((f) => isImageMime(f.type));

const pad = (n: number) => String(n).padStart(2, '0');
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/**
 * Trình duyệt luôn đặt tên `image.png` cho ảnh dán nên các ảnh sẽ trùng tên → đổi theo thời gian.
 * `seq` > 0 (nhiều ảnh dán cùng lúc) thêm hậu tố `-2`, `-3`… để không trùng trong cùng giây.
 */
export function pastedImageName(f: Pick<File, 'type'>, now: Date, seq = 0): string {
  const t = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const ext = EXT[f.type.toLowerCase()] ?? 'png';
  return `anh-dan-${t}${seq > 0 ? `-${seq + 1}` : ''}.${ext}`;
}

const placeholder = (id: number) => `![Đang tải ảnh-${id}…]()`;
const PLACEHOLDER_ANY = /!\[Đang tải ảnh-\d+…\]\(\)/g;

/** Còn chữ giữ chỗ "Đang tải ảnh" trong nội dung (vd nháp cũ được khôi phục). */
export const hasPlaceholder = (value: string): boolean =>
  new RegExp(PLACEHOLDER_ANY.source).test(value);

/** Gỡ mọi chữ giữ chỗ còn sót trước khi lưu/gửi — không để chữ "Đang tải ảnh-1…" nằm vĩnh viễn trong dữ liệu. */
export const stripPlaceholders = (value: string): string => value.replace(PLACEHOLDER_ANY, '');

/** Chèn chữ giữ chỗ tại con trỏ trong lúc ảnh đang tải; trả giá trị mới + vị trí con trỏ sau chữ giữ chỗ. */
export function insertPlaceholder(value: string, caret: number, id: number) {
  const ph = placeholder(id);
  return { value: value.slice(0, caret) + ph + value.slice(caret), caret: caret + ph.length };
}

/** Thay (hoặc xoá, nếu `replacement` rỗng) đúng chữ giữ chỗ của `id`; không còn chữ giữ chỗ thì giữ nguyên. */
export const replacePlaceholder = (value: string, id: number, replacement: string): string =>
  value.replace(placeholder(id), () => replacement);

/** `![tên](attachment:ID)`; ký tự phá cú pháp (`[ ] ( )`) và xuống dòng bị bỏ khỏi tên. */
export const attachmentMarkdown = (name: string, ref: string): string =>
  `![${name.replace(/[[\]()\r\n]/g, '')}](${ref})`;
