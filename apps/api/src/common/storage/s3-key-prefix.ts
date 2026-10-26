/**
 * Chuẩn hoá/kiểm tra `S3_KEY_PREFIX` (tiền tố khoá khi dùng chung bucket với app khác, vd `tirapro/`).
 * Rỗng ⇒ không tiền tố. Khác rỗng ⇒ luôn kết thúc bằng `/`. Chỉ cho ký tự an toàn `A-Za-z0-9._-` và `/`;
 * không bắt đầu bằng `/`, không `//`, không đoạn `.`/`..`, không `\`. Ném Error tiếng Việt nêu tên biến nếu sai.
 */
export function normalizeKeyPrefix(raw: string): string {
  const p = raw.trim();
  if (!p) return '';
  const fail = (why: string): never => {
    throw new Error(`S3_KEY_PREFIX không hợp lệ: ${why}`);
  };
  if (p.length > 200) fail('quá dài (tối đa 200 ký tự)');
  if (p.includes('\\')) fail('không được chứa dấu "\\"');
  if (p.startsWith('/')) fail('không được bắt đầu bằng "/"');
  if (p.includes('//')) fail('không được chứa "//"');
  if (!/^[A-Za-z0-9._\-/]+$/.test(p)) fail('chỉ gồm chữ không dấu, số và các ký tự . _ - /');
  if (p.split('/').some((seg) => seg === '..')) fail('không được chứa đoạn ".."');
  if (p.split('/').some((seg) => seg === '.')) fail('không được chứa đoạn "."');
  return p.endsWith('/') ? p : `${p}/`;
}
