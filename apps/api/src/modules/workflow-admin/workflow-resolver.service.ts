import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { getStore, type RequestStore } from '../../common/context/request-context';
import { NotFoundAppException } from '../../common/exceptions/app.exception';

/** Một phần Prisma mà resolver dùng — nhận cả `PrismaService` lẫn client trong `$transaction`. */
type Db = Pick<
  Prisma.TransactionClient,
  'project' | 'projectWorkflowOverride' | 'organizationWorkflowScheme' | 'issueType'
>;

/** Cấu hình quy trình đã nạp của MỘT dự án: đủ để suy ra quy trình cho mọi loại việc. */
interface LoadedScheme {
  organizationId: string;
  defaultWorkflowId: string | null;
  overrides: Map<string, string>;
  scheme: Map<string, string>;
}

/**
 * Cache theo request: khoá bằng chính object `RequestStore` của AsyncLocalStorage nên tự giải phóng khi
 * request kết thúc. Ngoài request (worker/script, không có store) thì KHÔNG cache.
 */
const cacheByRequest = new WeakMap<RequestStore, Map<string, Promise<LoadedScheme>>>();

type SchemeCache = Map<string, Promise<LoadedScheme>>;

/**
 * Bộ nhớ đệm theo LẦN CHẠY cho việc nền (import) — không có `RequestStore` nên cache theo request không áp dụng được, mà mỗi
 * dòng nhập lại hỏi quy trình (~4 truy vấn/dòng). `runWithWorkflowMemo` mở một bộ nhớ riêng cho mọi lời gọi resolver bên trong
 * (AsyncLocalStorage lan theo chuỗi async), bỏ đi khi hàm kết thúc. Lồng nhau thì dùng chung bộ nhớ ngoài cùng.
 */
const memoStorage = new AsyncLocalStorage<SchemeCache>();

export function runWithWorkflowMemo<T>(fn: () => Promise<T>): Promise<T> {
  return memoStorage.getStore() ? fn() : memoStorage.run(new Map(), fn);
}

/**
 * Nguồn duy nhất cho câu hỏi "việc loại X của dự án P theo quy trình nào":
 * ghi đè của dự án → quy trình tổ chức (scheme) → `Project.defaultWorkflowId`.
 *
 * Cache trong một request đủ vì cấu hình này chỉ đổi qua các thao tác quản trị; thao tác đó phải gọi
 * `invalidate()` nếu còn đọc lại quy trình trong cùng request.
 */
@Injectable()
export class WorkflowResolver {
  /**
   * Quy trình của loại việc trong dự án. Không có gì khớp (dự án chưa có quy trình mặc định, chưa có
   * scheme) thì `workflowId = ''`, giữ đúng hành vi cũ của `defaultWorkflowId ?? ''`.
   */
  async forIssue(tx: Db, projectId: string, typeId: string): Promise<{ workflowId: string }> {
    const loaded = await this.load(tx, projectId);
    return { workflowId: this.pick(loaded, typeId) ?? '' };
  }

  /** Quy trình của mọi loại việc trong tổ chức của dự án. Loại không suy ra được thì vắng trong Map. */
  async forProject(tx: Db, projectId: string): Promise<Map<string, string>> {
    const loaded = await this.load(tx, projectId);
    const types = await tx.issueType.findMany({
      where: { organizationId: loaded.organizationId },
      select: { id: true },
    });
    const out = new Map<string, string>();
    for (const t of types) {
      const wf = this.pick(loaded, t.id);
      if (wf) out.set(t.id, wf);
    }
    return out;
  }

  /** Bỏ cache của một dự án (hoặc cả request) — gọi sau khi đổi scheme/ghi đè trong cùng request. */
  invalidate(projectId?: string): void {
    const store = getStore();
    for (const cache of [store && cacheByRequest.get(store), memoStorage.getStore()]) {
      if (!cache) continue;
      if (projectId === undefined) cache.clear();
      else cache.delete(projectId);
    }
  }

  private pick(l: LoadedScheme, typeId: string): string | null {
    return l.overrides.get(typeId) ?? l.scheme.get(typeId) ?? l.defaultWorkflowId ?? null;
  }

  /** Bộ nhớ đang áp dụng: theo lần chạy (import) thắng theo request; không có cả hai thì không cache. */
  private activeCache(): SchemeCache | undefined {
    const memo = memoStorage.getStore();
    if (memo) return memo;
    const store = getStore();
    if (!store) return undefined;
    let cache = cacheByRequest.get(store);
    if (!cache) {
      cache = new Map();
      cacheByRequest.set(store, cache);
    }
    return cache;
  }

  private load(tx: Db, projectId: string): Promise<LoadedScheme> {
    const cache = this.activeCache();
    if (!cache) return this.fetch(tx, projectId);
    const hit = cache.get(projectId);
    if (hit) return hit;
    const pending = this.fetch(tx, projectId);
    cache.set(projectId, pending);
    // Lỗi không được nhớ lại: lần gọi sau thử lại.
    pending.catch(() => {
      if (cache.get(projectId) === pending) cache.delete(projectId);
    });
    return pending;
  }

  private async fetch(tx: Db, projectId: string): Promise<LoadedScheme> {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true, defaultWorkflowId: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');
    const [overrides, scheme] = await Promise.all([
      tx.projectWorkflowOverride.findMany({
        where: { projectId },
        select: { issueTypeId: true, workflowId: true },
      }),
      tx.organizationWorkflowScheme.findMany({
        where: { organizationId: project.organizationId },
        select: { issueTypeId: true, workflowId: true },
      }),
    ]);
    return {
      organizationId: project.organizationId,
      defaultWorkflowId: project.defaultWorkflowId,
      overrides: new Map(overrides.map((o) => [o.issueTypeId, o.workflowId])),
      scheme: new Map(scheme.map((s) => [s.issueTypeId, s.workflowId])),
    };
  }
}
