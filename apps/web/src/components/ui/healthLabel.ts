import type { ProjectHealthDto, ProjectHealthLevel } from '@tirapro/shared';

/** Nhãn tiếng Việt của mức sức khoẻ dự án (chữ luôn đi kèm icon/màu — không chỉ-màu). */
export function healthLabel(level: ProjectHealthLevel): string {
  switch (level) {
    case 'GREEN':
      return 'Tốt';
    case 'YELLOW':
      return 'Cần chú ý';
    case 'RED':
      return 'Nguy cơ';
    default:
      return 'Chưa đủ dữ liệu';
  }
}

/** Phần "Tự tính: Vàng — 3/9 việc quá hạn" (lý do rỗng thì chỉ có mức). */
export function healthAutoText(auto: ProjectHealthDto['auto']): string {
  const reasons = auto.reasons.join('; ');
  return `Tự tính: ${healthLabel(auto.level)}${reasons ? ` — ${reasons}` : ''}`;
}

/** Cột "Lý do" của CSV: ghi chú PM (nếu ghi đè) rồi lý do tự tính; không có gì → rỗng. */
export function healthReasonText(dto: ProjectHealthDto | null): string {
  if (!dto) return '';
  const reasons = dto.auto.reasons.join('; ');
  if (dto.override) {
    return `Ghi đè: ${dto.override.note}${reasons ? ` | Tự tính: ${reasons}` : ''}`;
  }
  return reasons;
}

/**
 * Câu tóm tắt một dòng cho tooltip/CSV: ghi đè (kèm ghi chú) đứng đầu rồi tới phần tự tính;
 * không có ghi đè thì chỉ mức + lý do tự tính. `null` = chưa có dữ liệu sức khoẻ.
 */
export function healthSummaryText(dto: ProjectHealthDto | null): string {
  if (!dto) return healthLabel('NONE');
  if (dto.override) {
    return `${healthLabel(dto.override.level)} (ghi đè): ${dto.override.note} · ${healthAutoText(dto.auto)}`;
  }
  const reasons = dto.auto.reasons.join('; ');
  return reasons ? `${healthLabel(dto.level)} — ${reasons}` : healthLabel(dto.level);
}
