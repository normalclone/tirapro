import { Prisma, type PrismaClient } from '@prisma/client';
import { Semaphore } from './semaphore';

/**
 * Đếm issue CÓ GIỚI HẠN cho các endpoint "xem trước/gợi ý" (gợi ý nới bộ lọc 092, xem trước số việc khớp quy tắc 132b).
 * Mỗi lần đếm giữ MỘT kết nối DB (giao dịch tương tác) tới `BOUNDED_COUNT_STATEMENT_TIMEOUT_MS`, còn throttle của route
 * chỉ tính theo IP, nên cần trần chung cho CẢ tiến trình.
 *
 * NGÂN SÁCH KẾT NỐI: tối đa `BOUNDED_COUNT_GLOBAL_SLOTS` (= 3) lần đếm cùng lúc trong cả tiến trình, MỌI endpoint dùng
 * hàm này chung một semaphore → các đếm xem trước chiếm không quá 3 trên `connection_limit=10`, chừa ≥ 7 kết nối cho phần
 * còn lại của API. Mỗi request còn có hạn tổng (`BOUNDED_COUNT_DEADLINE_MS`): lần đếm chưa kịp lấy chỗ khi hết hạn trả
 * `null` thay vì chờ vô hạn.
 */
const BOUNDED_COUNT_GLOBAL_SLOTS = 3;
export const BOUNDED_COUNT_DEADLINE_MS = 5_000;
const BOUNDED_COUNT_STATEMENT_TIMEOUT_MS = 3_000;
export const BOUNDED_COUNT_SLOTS = new Semaphore(BOUNDED_COUNT_GLOBAL_SLOTS);

/**
 * Postgres huỷ truy vấn vì `statement_timeout`, hoặc giao dịch tương tác hết hạn/không lấy được kết nối (P2028).
 * Khớp HẸP: `meta.code === '57014'` (lỗi raw, P2010), cụm Postgres "canceling statement due to statement timeout", hoặc
 * thẻ `code: "57014"` (lỗi theo model của Prisma) — không khớp số 57014 hay chữ "statement timeout" rời rạc (cổng, tham số).
 */
export function isCountTimeout(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const err = e as Error & { code?: unknown; meta?: { code?: unknown } };
  return (
    err.meta?.code === '57014' ||
    err.code === 'P2028' ||
    /canceling statement due to statement timeout/i.test(err.message) ||
    /\bcode:\s*[`"']?57014(?!\d)/i.test(err.message)
  );
}

/**
 * MỘT lần đếm issue: xin chỗ trong semaphore chung (chờ tối đa đến `deadlineAt`), rồi giao dịch tương tác với
 * `SET LOCAL statement_timeout` (chỉ tác dụng trong giao dịch này, trả về kết nối sạch cho pool). Hết hạn/quá giờ → `null`;
 * lỗi khác → ném lại. Chỗ luôn được nhả. `where` do nơi gọi dựng (phải đã gồm phạm vi workspace/dự án/quyền xem);
 * ở đây chỉ lặp `deletedAt: null` làm chốt chặn tầng thấp nhất để việc đã xoá mềm không bao giờ được đếm.
 */
export async function boundedIssueCount(
  prisma: Pick<PrismaClient, '$transaction'>,
  where: Prisma.IssueWhereInput,
  deadlineAt: number,
): Promise<number | null> {
  const release = await BOUNDED_COUNT_SLOTS.acquire(deadlineAt);
  if (!release) return null;
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Hằng số nguyên của mã nguồn (SET không nhận tham số ràng buộc) — không bao giờ nhận dữ liệu người dùng.
        await tx.$executeRaw(
          Prisma.sql`SET LOCAL statement_timeout = ${Prisma.raw(String(BOUNDED_COUNT_STATEMENT_TIMEOUT_MS))}`,
        );
        return tx.issue.count({ where: { deletedAt: null, AND: [where] } });
      },
      { maxWait: 2_000, timeout: BOUNDED_COUNT_STATEMENT_TIMEOUT_MS + 2_000 },
    );
  } catch (e) {
    if (isCountTimeout(e)) return null;
    throw e;
  } finally {
    release();
  }
}
