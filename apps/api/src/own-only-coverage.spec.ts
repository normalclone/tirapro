import 'reflect-metadata';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS } from '@tirapro/types';
import { describe, expect, it } from 'vitest';
import { ownOnlyFactory } from './common/decorators/own-only.decorator';
import { PERMISSIONS_KEY } from './common/decorators/permissions.decorator';

/** Route cần `:own` cho quyền sửa/chuyển trạng thái issue mà KHÔNG nhận @OwnOnly = lỗ hổng (người chỉ có :own sửa được việc người khác). */
const OWN_AWARE = [PERMISSIONS.ISSUE_EDIT, PERMISSIONS.ISSUE_TRANSITION] as const;
/** Không thuộc một issue cụ thể (theo projectId trong body) nên không có gì để kiểm sở hữu. */
const EXEMPT = new Set(['AiController.suggestAssignee']);
/** Handler có @OwnOnly nhưng chạy thử không gọi service nào với `ownOnly=true` (hiện không có ngoại lệ; thêm `Ctrl.handler` kèm lý do nếu cần). */
const EXEMPT_NO_OWNERSHIP_CALL = new Set<string>();

type Ctor = (new (...a: never[]) => unknown) & { prototype: Record<string, unknown> };
type Call = { path: string; args: unknown[] };

/** Stub đệ quy: mọi thuộc tính là hàm ghi nhận lời gọi và trả Promise resolve ra stub khác (`then` = undefined để không bị await vô hạn). */
function makeStub(calls: Call[], path = 'stub'): unknown {
  const fn = (): void => undefined;
  return new Proxy(fn, {
    get: (_t, prop) => {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      return makeStub(calls, `${path}.${prop}`);
    },
    apply: (_t, _this, args: unknown[]) => {
      calls.push({ path, args });
      return Promise.resolve(makeStub(calls, `${path}()`));
    },
  });
}

/**
 * CHẠY THỬ handler với `ownOnly=true` và mọi dependency là stub, rồi đòi có ít nhất một lời gọi service nhận đối số
 * `true` (đúng là `ownership.assertOwns*(ownOnly, …)` hoặc `service.method(…, ownOnly)`). Không đọc mã nguồn nên
 * dòng bị comment, `void ownOnly`, chuỗi chứa tên `ownOnly` đều KHÔNG qua được. Vị trí tham số lấy từ metadata
 * ROUTE_ARGS của Nest. Lỗi ném ra trong lúc chạy thử được coi là không đạt (fail-closed).
 */
async function handlerUsesOwnOnly(ctrl: Ctor, name: string): Promise<boolean> {
  const calls: Call[] = [];
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, ctrl, name) ?? {}) as Record<
    string,
    { index: number; factory?: unknown }
  >;
  const entries = Object.values(args);
  const argv: unknown[] = [];
  for (let i = 0; i <= Math.max(-1, ...entries.map((e) => e.index)); i++) argv[i] = makeStub(calls);
  for (const e of entries) if (e.factory === ownOnlyFactory) argv[e.index] = true;
  const nDeps = Math.max(
    ctrl.length,
    ((Reflect.getMetadata('design:paramtypes', ctrl) ?? []) as unknown[]).length,
  );
  const instance = new ctrl(...(Array.from({ length: nDeps }, () => makeStub(calls)) as never[]));
  const method = (instance as Record<string, (...a: unknown[]) => unknown>)[name]!;
  try {
    await method.apply(instance, argv);
  } catch {
    return false;
  }
  return calls.some((c) => c.args.includes(true));
}

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return name.endsWith('.controller.ts') ? [full] : [];
  });
}

type ArgMeta = Record<string, { factory?: unknown; data?: unknown }>;

/**
 * Giới hạn: spec chỉ quét `modules/**\/*.controller.ts` và chỉ thấy handler khai báo TRỰC TIẾP trên prototype
 * của controller (`getOwnPropertyNames`) — handler kế thừa từ lớp cha hoặc controller ngoài `modules/` không được kiểm.
 */
describe('@OwnOnly coverage', () => {
  it('mọi route ISSUE_EDIT/ISSUE_TRANSITION nhận @OwnOnly tương ứng', async () => {
    const root = join(__dirname, 'modules');
    const missing: string[] = [];
    let checked = 0;
    for (const file of controllerFiles(root).sort()) {
      const mod = (await import(file)) as Record<string, unknown>;
      for (const exported of Object.values(mod)) {
        if (typeof exported !== 'function') continue;
        const ctrl = exported as Ctor;
        if (Reflect.getMetadata('path', ctrl) === undefined) continue;
        for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
          const handler = ctrl.prototype[name];
          if (
            name === 'constructor' ||
            typeof handler !== 'function' ||
            Reflect.getMetadata('method', handler) === undefined
          )
            continue;
          const perms = (Reflect.getMetadata(PERMISSIONS_KEY, handler) ??
            Reflect.getMetadata(PERMISSIONS_KEY, ctrl) ??
            []) as string[];
          const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, ctrl, name) ?? {}) as ArgMeta;
          for (const p of OWN_AWARE) {
            if (!perms.includes(p)) continue;
            checked++;
            const ok = Object.values(args).some(
              (a) => a.factory === ownOnlyFactory && a.data === p,
            );
            if (!ok && !EXEMPT.has(`${ctrl.name}.${name}`))
              missing.push(`${relative(root, file)} → ${ctrl.name}.${name} (${p})`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(20);
    expect(missing, `Route thiếu @OwnOnly:\n${missing.join('\n')}`).toEqual([]);
  });

  it('mọi handler có @OwnOnly thật sự kiểm sở hữu (chạy thử: service nhận ownOnly=true)', async () => {
    const root = join(__dirname, 'modules');
    const unchecked: string[] = [];
    let checked = 0;
    for (const file of controllerFiles(root).sort()) {
      const mod = (await import(file)) as Record<string, unknown>;
      for (const exported of Object.values(mod)) {
        if (typeof exported !== 'function') continue;
        const ctrl = exported as Ctor;
        if (Reflect.getMetadata('path', ctrl) === undefined) continue;
        for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
          if (name === 'constructor' || typeof ctrl.prototype[name] !== 'function') continue;
          const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, ctrl, name) ?? {}) as ArgMeta;
          if (!Object.values(args).some((a) => a.factory === ownOnlyFactory)) continue;
          checked++;
          const id = `${ctrl.name}.${name}`;
          if (!(await handlerUsesOwnOnly(ctrl, name)) && !EXEMPT_NO_OWNERSHIP_CALL.has(id))
            unchecked.push(`${relative(root, file)} → ${id}`);
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(20);
    expect(
      unchecked,
      `Handler nhận @OwnOnly nhưng không kiểm sở hữu:\n${unchecked.join('\n')}`,
    ).toEqual([]);
  });
});

/** Dependency giả của controller giả: gọi gì cũng được (stub của `makeStub`). */
type Deps = {
  ownership: { assertOwnsIssue: (...a: unknown[]) => unknown };
  svc: { update: (...a: unknown[]) => unknown };
};

describe('handlerUsesOwnOnly (chính bộ kiểm)', () => {
  /** Dựng controller giả với một handler `h(ownOnly)`; `body` quyết định handler làm gì. */
  function fake(body: (ownOnly: boolean, self: Deps) => unknown): Ctor {
    class Fake {
      constructor(
        readonly ownership: unknown,
        readonly svc: unknown,
      ) {}
      h(ownOnly: boolean) {
        return Promise.resolve(body(ownOnly, this as unknown as Deps));
      }
    }
    Reflect.defineMetadata(
      ROUTE_ARGS_METADATA,
      { 'custom:0': { index: 0, factory: ownOnlyFactory, data: 'issue:edit' } },
      Fake,
      'h',
    );
    return Fake as unknown as Ctor;
  }

  it('gọi ownership.assertOwns*(ownOnly) hoặc truyền ownOnly xuống service -> đạt', async () => {
    expect(
      await handlerUsesOwnOnly(
        fake((o, s) => s.ownership.assertOwnsIssue(o, 'w', 'u', 'i')),
        'h',
      ),
    ).toBe(true);
    expect(
      await handlerUsesOwnOnly(
        fake((o, s) => s.svc.update('w', 'u', 'i', {}, o)),
        'h',
      ),
    ).toBe(true);
  });

  it('lời gọi bị comment, `void ownOnly`, chuỗi chứa tên, hoặc không dùng -> báo vi phạm', async () => {
    expect(
      await handlerUsesOwnOnly(
        fake((_o, s) => {
          // await s.ownership.assertOwnsIssue(ownOnly, 'w', 'u', 'i');
          return s.svc.update('w', 'u', 'i', {});
        }),
        'h',
      ),
    ).toBe(false);
    expect(
      await handlerUsesOwnOnly(
        fake((o, s) => (void o, s.svc.update('w'))),
        'h',
      ),
    ).toBe(false);
    expect(
      await handlerUsesOwnOnly(
        fake((_o, s) => s.svc.update('ownOnly')),
        'h',
      ),
    ).toBe(false);
    expect(
      await handlerUsesOwnOnly(
        fake(() => undefined),
        'h',
      ),
    ).toBe(false);
  });

  it('handler ném lỗi khi chạy thử -> không đạt (fail-closed)', async () => {
    expect(
      await handlerUsesOwnOnly(
        fake(() => {
          throw new Error('boom');
        }),
        'h',
      ),
    ).toBe(false);
  });
});
