/**
 * Sửa tên tệp bị multer/busboy giải mã LATIN1 (byte UTF-8 của "báo cáo" thành "bÃ¡o cÃ¡o").
 * Chỉ đổi khi chắc chắn: mọi ký tự ≤ U+00FF (đúng dạng "UTF-8 bị đọc như latin1"), giải mã UTF-8 không sinh U+FFFD và
 * kết quả khác bản gốc. Ngược lại giữ nguyên — an toàn cho client đã gửi UTF-8 đúng và cho tên latin1 thật ("café").
 */
export function fixLatin1Utf8(name: string): string {
  if (!name) return name;
  for (let i = 0; i < name.length; i++) if (name.charCodeAt(i) > 0xff) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded !== name && !decoded.includes('\uFFFD') ? decoded : name;
}

/** Bỏ dấu tiếng Việt để làm tên dự phòng ASCII. */
function asciiFold(s: string): string {
  return s
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Mã hoá theo RFC 5987 (attr-char): chỉ giữ ALPHA DIGIT và `!#$&+-.^_`|~`. */
function encodeRfc5987(s: string): string {
  return encodeURIComponent(s).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Header Content-Disposition tải xuống theo RFC 6266/5987: `filename="<ASCII dự phòng>"; filename*=UTF-8''<percent-encode>`.
 * Bản dự phòng chỉ gồm ASCII in được, không có `"`, `\`, `;`, `/`, `%` hay ký tự điều khiển (chống chèn header);
 * bản `filename*` được percent-encode hoàn toàn nên không thoát được khỏi giá trị.
 */
export function contentDispositionAttachment(fileName: string): string {
  const fallback =
    asciiFold(fileName)
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\;/%]/g, '_')
      .trim() || 'file';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}
