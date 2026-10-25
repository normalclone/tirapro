import 'reflect-metadata';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AUTH_ONLY_KEY } from './common/decorators/auth-only.decorator';
import { OPTIONAL_AUTH_KEY } from './common/decorators/optional-auth.decorator';
import { PERMISSIONS_KEY } from './common/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from './common/decorators/public.decorator';
import { PROJECT_REF_KEY } from './common/decorators/project-ref.decorator';
import { PERMISSIONS } from '@tirapro/types';

// Spec này nạp toàn bộ module để dò decorator: một mình chạy < 1 giây nhưng khi máy bận (CI, chạy song song
// với build) có thể quá 5 giây mặc định — nới timeout để tránh đỏ giả.
vi.setConfig({ testTimeout: 30_000 });

/** Mọi route HTTP phải khai báo rõ chính sách truy cập — không có "quên" = "ai đăng nhập cũng vào được". */

const METHOD_METADATA = 'method'; // key RequestMapping của @nestjs/common (Get/Post/…)
const PATH_METADATA = 'path';
const ACCESS_KEYS = [PERMISSIONS_KEY, IS_PUBLIC_KEY, AUTH_ONLY_KEY, OPTIONAL_AUTH_KEY];

function findControllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...findControllerFiles(full));
    else if (name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

type Ctor = (new (...args: never[]) => unknown) & { prototype: Record<string, unknown> };

describe('RBAC coverage', () => {
  it('mọi route có @Permissions, @Public, @AuthOnly hoặc @OptionalAuth', async () => {
    const root = join(__dirname, 'modules');
    const missing: string[] = [];
    let routes = 0;
    for (const file of findControllerFiles(root).sort()) {
      const mod = (await import(file)) as Record<string, unknown>;
      for (const exported of Object.values(mod)) {
        if (typeof exported !== 'function') continue;
        const ctrl = exported as Ctor;
        if (Reflect.getMetadata(PATH_METADATA, ctrl) === undefined) continue; // không phải @Controller
        for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
          if (name === 'constructor') continue;
          const handler = ctrl.prototype[name];
          if (typeof handler !== 'function') continue;
          if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue; // không có @Get/@Post…
          routes++;
          const perms = (Reflect.getMetadata(PERMISSIONS_KEY, handler) ??
            Reflect.getMetadata(PERMISSIONS_KEY, ctrl)) as unknown[] | undefined;
          // `@Permissions()` rỗng = guard cho qua mọi người → coi như thiếu khai báo.
          const emptyPerms = perms !== undefined && perms.length === 0;
          const declared =
            !emptyPerms &&
            ACCESS_KEYS.some(
              (key) =>
                Reflect.getMetadata(key, handler) !== undefined ||
                Reflect.getMetadata(key, ctrl) !== undefined,
            );
          if (!declared) missing.push(`${relative(root, file)} → ${ctrl.name}.${name}`);
        }
      }
    }
    expect(routes).toBeGreaterThanOrEqual(250); // chặn trường hợp quét hụt thư mục
    expect(missing, `Route thiếu @Permissions/@Public/@AuthOnly:\n${missing.join('\n')}`).toEqual(
      [],
    );
  });

  it('route thả cảm xúc (077): chỉ cần XEM được việc (PROJECT_VIEW), KHÔNG COMMENT_CREATE; khoá theo bình luận → dự án', async () => {
    const { CommentsController } = await import('./modules/comments/comments.controller');
    const proto = CommentsController.prototype as unknown as Record<string, object>;
    for (const name of ['react', 'unreact']) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[name]!), name).toEqual([
        PERMISSIONS.PROJECT_VIEW,
      ]);
      expect(Reflect.getMetadata(PROJECT_REF_KEY, proto[name]!), name).toMatchObject({
        kind: 'comment',
        param: 'id',
      });
    }
  });
});
