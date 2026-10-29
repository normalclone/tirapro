import type { KeyResultInput, KeyResultSource } from './api';
import { defaultConfig, isAutoSource, isSourceConfigComplete } from './krSource';

/** Một dòng KR trong form sửa mục tiêu: dữ liệu nhập + vết của bản đã tải (để chỉ gửi phần người dùng thật sự đổi). */
export interface DraftKr extends KeyResultInput {
  /** Khoá React ổn định cho dòng chưa lưu. */
  rowKey: string;
  /** Nguồn và số hiện tại lúc mở form (KR đã lưu). */
  originalSource?: KeyResultSource;
  originalCurrent?: number;
  /** BE che cấu hình nguồn (dự án riêng tư / JQL cần GOAL_MANAGE): không hiện, không gửi lại → BE giữ nguyên. */
  configHidden?: boolean;
}

/** KR tự đo đã lưu mà BE không trả cấu hình (`sourceConfig = null`) → cấu hình đang bị che với người sửa. */
export function isConfigHidden(kr: { source: KeyResultSource; sourceConfig: unknown }): boolean {
  return isAutoSource(kr.source) && kr.sourceConfig === null;
}

/** Dòng có đủ cấu hình để lưu chưa (cấu hình bị che và không đổi nguồn thì coi là đủ). */
export function isDraftComplete(kr: DraftKr): boolean {
  const source = kr.source ?? 'MANUAL';
  if (kr.configHidden && source === kr.originalSource) return true;
  return isSourceConfigComplete(source, kr.sourceConfig ?? null);
}

/**
 * Payload của một KR khi lưu form:
 * - KR tự đo: không gửi `currentValue` (hệ thống đo); cấu hình bị che + không đổi nguồn → không gửi source/sourceConfig.
 * - KR nhập tay đã lưu: chỉ gửi `currentValue` khi người dùng đổi (hoặc vừa chuyển từ tự đo sang nhập tay), kèm
 *   `expectedCurrentValue` = số lúc mở form → BE trả 409 nếu người khác vừa check-in (không ghi đè số mới bằng số cũ).
 */
export function toKeyResultInput(kr: DraftKr): KeyResultInput {
  const source = kr.source ?? 'MANUAL';
  const out: KeyResultInput = {
    id: kr.id,
    name: kr.name.trim(),
    unit: kr.unit ?? 'NUMBER',
    startValue: Number(kr.startValue ?? 0),
    targetValue: Number(kr.targetValue ?? 0),
    unitLabel: kr.unitLabel?.trim() || null,
  };
  if (!(kr.configHidden && source === kr.originalSource)) {
    out.source = source;
    out.sourceConfig = isAutoSource(source) ? (kr.sourceConfig ?? defaultConfig(source)) : null;
  }
  if (!isAutoSource(source)) {
    const value = Number(kr.currentValue ?? 0);
    const isNew = kr.id === undefined;
    const wasAuto = kr.originalSource !== undefined && isAutoSource(kr.originalSource);
    if (isNew || wasAuto || value !== kr.originalCurrent) {
      out.currentValue = value;
      if (!isNew && !wasAuto && kr.originalCurrent !== undefined)
        out.expectedCurrentValue = kr.originalCurrent;
    }
  }
  return out;
}
