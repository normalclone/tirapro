import type { DigestModel } from '@tirapro/shared';

/** Giới hạn độ dài một tin nhắn Telegram (sau khi parse HTML). */
export const TELEGRAM_MAX_LENGTH = 4096;

/** Escape ký tự HTML — CHỈ gọi ở lớp render Telegram (mô hình dữ liệu luôn là văn bản thuần). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

interface Unit {
  text: string;
  /** Dòng nội dung (đếm vào "còn N dòng" khi bị cắt); tiêu đề/dòng trống không đếm. */
  content: boolean;
}

/** `esc` = escape văn bản của kênh; `bold` nhận chuỗi ĐÃ escape. */
function toUnits(
  model: DigestModel,
  esc: (s: string) => string,
  bold: (escaped: string) => string,
): Unit[] {
  const units: Unit[] = [{ text: `📊 ${bold(esc(model.title))}`, content: false }];
  if (model.subtitle) units.push({ text: esc(model.subtitle), content: false });
  for (const section of model.sections) {
    if (section.lines.length === 0) continue;
    units.push({ text: '', content: false }, { text: bold(esc(section.title)), content: false });
    for (const line of section.lines) units.push({ text: `• ${esc(line)}`, content: true });
  }
  return units;
}

/**
 * Telegram `parse_mode: HTML`: tiêu đề in đậm, nội dung escape đúng một lần. Quá 4096 ký tự → bỏ bớt các dòng cuối
 * và ghi "…(còn N dòng)" để người đọc biết bị cắt (cắt theo dòng nên không bao giờ cắt giữa thực thể `&amp;`).
 */
export function renderTelegramHtml(model: DigestModel): string {
  const units = toUnits(model, escapeHtml, (s) => `<b>${s}</b>`);
  const full = units.map((u) => u.text).join('\n');
  if (full.length <= TELEGRAM_MAX_LENGTH) return full;

  const reserve = '\n…(còn 99999 dòng)'.length;
  const kept: string[] = [];
  let used = 0;
  let cut = units.length;
  for (let i = 0; i < units.length; i++) {
    const add = units[i]!.text.length + (kept.length ? 1 : 0);
    if (used + add > TELEGRAM_MAX_LENGTH - reserve) {
      cut = i;
      break;
    }
    kept.push(units[i]!.text);
    used += add;
  }
  const remaining = units.slice(cut).filter((u) => u.content).length;
  return `${kept.join('\n')}\n…(còn ${remaining} dòng)`;
}

/** Văn bản thuần cho giao diện (xem trước/toast) và phần text của email: không HTML, không entity. */
export function renderPlainText(model: DigestModel): string {
  return toUnits(
    model,
    (s) => s,
    (s) => s,
  )
    .map((u) => u.text)
    .join('\n');
}
