import type { Prisma } from '@prisma/client';

/**
 * Điểm của Epic = TỔNG điểm việc con (`PointsService.rollupEpics`), nên mọi phép CỘNG điểm phía server (sprint, báo cáo,
 * burndown, KR, tải công việc…) phải loại Epic — nếu không điểm của Epic và của từng việc con bị đếm đôi. Dùng cho các
 * truy vấn chỉ để cộng điểm (số ĐẾM việc giữ nguyên, truy vấn riêng). Hiển thị điểm TỪNG việc không dùng bộ lọc này.
 * `NOT: { type }` (không phải `key: { not: 'EPIC' }`) để loại có chủ đích mà vẫn giữ loại tuỳ chỉnh có `key` null.
 */
export const EXCLUDE_EPIC_POINTS: Prisma.IssueWhereInput = { NOT: { type: { key: 'EPIC' } } };

/** Cùng ý nghĩa cho hàng đã nạp sẵn `type.key` (cộng điểm trong bộ nhớ). */
export const countsTowardPoints = (issue: { type: { key: string | null } }): boolean =>
  issue.type.key !== 'EPIC';
