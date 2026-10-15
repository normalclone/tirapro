import type { SprintDto } from '@tirapro/types';

export const BACKLOG_LABEL = 'Backlog — chưa xếp vào sprint';

/**
 * Lựa chọn sprint cho một issue. Sprint đã CLOSED không cho CHUYỂN VÀO, nhưng nếu issue đang nằm trong đó thì vẫn phải
 * hiện đúng tên (trước đây bị lọc mất nên issue hiện nhầm thành "Backlog"). Chưa tải xong danh sách / sprint không còn
 * trong danh sách → nhãn trung tính, không bao giờ suy ra "Backlog" khi issue có `sprintId`.
 */
export function buildSprintOptions(
  sprints: SprintDto[] | undefined,
  currentSprintId: string | null,
): Array<{ value: string; label: string }> {
  const options = [{ value: '', label: BACKLOG_LABEL }];
  for (const s of sprints ?? []) {
    if (s.state === 'CLOSED') {
      if (s.id === currentSprintId) options.push({ value: s.id, label: `${s.name} · đã đóng` });
      continue;
    }
    options.push({ value: s.id, label: s.state === 'ACTIVE' ? `${s.name} · đang chạy` : s.name });
  }
  if (currentSprintId && !options.some((o) => o.value === currentSprintId))
    options.push({
      value: currentSprintId,
      label: sprints ? 'Sprint không xác định' : 'Đang tải sprint…',
    });
  return options;
}
