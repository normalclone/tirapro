import { Prisma, type PrismaClient } from '@prisma/client';
import { cpus } from 'node:os';
import { Semaphore } from './semaphore';

/**
 * Đếm issue CÓ GIỚI HẠN cho các endpoint "xem trước/gợi ý" (gợi ý nới bộ lọc 092, xem trước số việc khớp quy tắc 132b).
 * Mỗi lần đếm giữ MỘT kết nối DB (giao dịch tương tác) tới `BOUNDED_COUNT_STATEMENT_TIMEOUT_MS`, còn throttle của route
 * chỉ tính theo IP, nên cần trần chung cho CẢ tiến trình.
 *
 * NGÂN SÁCH KẾT NỐI: số lần đếm cùng lúc trong cả tiến trình = `boundedCountSlots(pool)` = clamp(floor(pool/3), 1, 3), với
 * `pool` là cỡ pool Prisma THẬT: `connection_limit` trong `DATABASE_URL` nếu có, nếu không là mặc định của Prisma
 * `num_cpus*2+1` (1 vCPU → 3, 2 vCPU → 5; `render.yaml` lấy URL của DB quản lý, KHÔNG có `connection_limit`). MỌI endpoint
 * dùng hàm này chung một semaphore → các đếm xem trước không bao giờ chiếm quá ~1/3 pool (pool=10 → 3 chỗ, chừa 7;
 * pool=3 → 1 chỗ, chừa 2). Muốn nhiều chỗ hơn thì đặt `connection_limit` tường minh (khuyến nghị ≥ 10, xem docs/DEPLOY.md).
 * Mỗi request còn có hạn tổng (`BOUNDED_COUNT_DEADLINE_MS`): lần đếm chưa kịp lấy chỗ khi hết hạn trả `null` thay vì chờ vô hạn.
 */
export const BOUNDED_COUNT_DEADLINE_MS = 5_000;
const BOUNDED_COUNT_STATEMENT_TIMEOUT_MS = 3_000;

/** Cỡ pool Prisma: `connection_limit` hợp lệ (số nguyên dương) trong URL, nếu không thì `num_cpus*2+1` (mặc định của Prisma). */
export function prismaPoolSize(databaseUrl: string | undefined, cpuCount: number): number {
  const m = /[?&]connection_limit=([^&#]*)/.exec(databaseUrl ?? '');
  const n = m ? Number(m[1]) : Number.NaN;
  if (Number.isInteger(n) && n > 0) return n;
  return Math.max(1, Math.floor(cpuCount)) * 2 + 1;
}

/** Số lần đếm đồng thời tối đa: clamp(floor(pool/3), 1, 3). Pool không hợp lệ vẫn cho ≥ 1 chỗ (không tắt tính năng). */
export function boundedCountSlots(poolSize: number): number {
  const third = Number.isFinite(poolSize) ? Math.floor(poolSize / 3) : 1;
  return Math.min(3, Math.max(1, third));
}

let slots: Semaphore | undefined;
/**
 * Semaphore chung của tiến trình, dựng LẦN ĐẦU được dùng (không phải lúc import): `ConfigModule` nạp `.env` vào
 * `process.env` sau khi các module được import, nên đọc `DATABASE_URL` lúc import sẽ thấy rỗng khi chạy dev.
 */
export function boundedCountSlotsSemaphore(): Semaphore {
  slots ??= new Semaphore(
    boundedCountSlots(prismaPoolSize(process.env.DATABASE_URL, cpus().length)),
  );
  return slots;
}

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
 * Chạy `fn` trong ngân sách chung: xin chỗ trong semaphore (chờ tối đa đến `deadlineAt`), rồi giao dịch tương tác với
 * `SET LOCAL statement_timeout` (chỉ tác dụng trong giao dịch này, trả về kết nối sạch cho pool). Hết hạn/quá giờ → `null`;
 * lỗi khác → ném lại. Chỗ luôn được nhả. Dùng cho mọi việc nặng của endpoint "xem trước/gợi ý" (đếm, tra toàn văn).
 */
export async function runBounded<T>(
  prisma: Pick<PrismaClient, '$transaction'>,
  deadlineAt: number,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T | null> {
  const release = await boundedCountSlotsSemaphore().acquire(deadlineAt);
  if (!release) return null;
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Hằng số nguyên của mã nguồn (SET không nhận tham số ràng buộc) — không bao giờ nhận dữ liệu người dùng.
        await tx.$executeRaw(
          Prisma.sql`SET LOCAL statement_timeout = ${Prisma.raw(String(BOUNDED_COUNT_STATEMENT_TIMEOUT_MS))}`,
        );
        return fn(tx);
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

/**
 * MỘT lần đếm issue trong ngân sách chung (`runBounded`). `where` do nơi gọi dựng (phải đã gồm phạm vi
 * workspace/dự án/quyền xem); ở đây chỉ lặp `deletedAt: null` làm chốt chặn tầng thấp nhất để việc đã xoá mềm không
 * bao giờ được đếm.
 */
export function boundedIssueCount(
  prisma: Pick<PrismaClient, '$transaction'>,
  where: Prisma.IssueWhereInput,
  deadlineAt: number,
): Promise<number | null> {
  return runBounded(prisma, deadlineAt, (tx) =>
    tx.issue.count({ where: { deletedAt: null, AND: [where] } }),
  );
}
