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

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return name.endsWith('.controller.ts') ? [full] : [];
  });
}

type Ctor = (new (...a: never[]) => unknown) & { prototype: Record<string, unknown> };
type ArgMeta = Record<string, { factory?: unknown; data?: unknown }>;

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
});
