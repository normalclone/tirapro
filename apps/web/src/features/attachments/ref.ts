/** Chỉ nhận id gồm chữ/số/gạch (cuid) — không bao giờ ghép ký tự lạ vào URL tải. */
const REF = /^attachment:([A-Za-z0-9_-]+)$/;

/** `![tên](attachment:ID)` → `ID`; mọi chuỗi khác (kể cả `javascript:`) → null. */
export const parseAttachmentRef = (src: string): string | null => REF.exec(src.trim())?.[1] ?? null;

/** Ảnh dựng được bằng `<img>` an toàn. SVG bị loại có chủ đích (có thể chứa script khi mở thẳng) — vẫn tải xuống như tệp thường. */
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
export const isImageMime = (mime: string): boolean => IMAGE_MIME.has(mime.toLowerCase());
