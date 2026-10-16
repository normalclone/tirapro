/** Bộ so khớp tối thiểu cho `where` của Prisma (OR, quan hệ lồng, some, null) — để chạy `where` trên dữ liệu mẫu. */
export function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
    const val = row[key];
    if (cond === null) return val === null || val === undefined;
    if (cond && typeof cond === 'object' && 'some' in cond) {
      return (
        Array.isArray(val) &&
        val.some((x) =>
          matches(
            x as Record<string, unknown>,
            (cond as { some: object }).some as Record<string, unknown>,
          ),
        )
      );
    }
    if (cond && typeof cond === 'object') {
      return (
        val != null && matches(val as Record<string, unknown>, cond as Record<string, unknown>)
      );
    }
    return val === cond;
  });
}
