import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { OPTIONAL_AUTH_KEY } from '../../../common/decorators/optional-auth.decorator';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { getStore } from '../../../common/context/request-context';
import { ApiKeyService } from '../../api-keys/api-key.service';
import type { AuthedRequest } from '../../../common/types/request';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Rút API key từ header: `X-API-Key: tira_…` hoặc `Authorization: Bearer tira_…`. */
function extractApiKey(req: AuthedRequest): string | null {
  const x = req.headers['x-api-key'];
  if (typeof x === 'string' && x.startsWith('tira_')) return x;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer tira_'))
    return auth.slice('Bearer '.length);
  return null;
}

/**
 * Xác thực JWT (người dùng web) HOẶC API key (tích hợp ngoài/MCP).
 * API key resolve ra AuthUser gắn workspace → mọi endpoint hiện có phục vụ được,
 * vẫn chịu RBAC (PermissionsGuard). Khoá read-only bị chặn mutation (non-GET).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeyService,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) {
      // Route công khai có thể xin "xác thực nếu có": gặp token hợp lệ thì gắn user, sai/thiếu thì vẫn cho qua.
      const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY, targets);
      if (optional) {
        try {
          await this.authenticate(context);
        } catch {
          /* bỏ qua — vẫn là khách */
        }
      }
      return true;
    }
    return this.authenticate(context);
  }

  private async authenticate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<AuthedRequest & { apiKey?: { id: string; scopes: string[] } }>();
    const raw = extractApiKey(req);
    if (raw) {
      const ctx = await this.apiKeys.validate(raw);
      if (!ctx) throw new UnauthorizedException('API key không hợp lệ hoặc đã thu hồi');
      req.user = {
        id: ctx.userId,
        email: ctx.email,
        displayName: ctx.displayName,
        workspaceId: ctx.workspaceId,
        isSystemAdmin: false,
      };
      req.apiKey = { id: ctx.keyId, scopes: ctx.scopes };
      if (!READ_METHODS.has(req.method) && !ctx.scopes.includes('write')) {
        // Không để lại danh tính của key bị từ chối (route @OptionalAuth nuốt lỗi sẽ coi như đã xác thực).
        req.user = undefined;
        req.apiKey = undefined;
        throw new ForbiddenException('API key chỉ có quyền đọc (read-only)');
      }
      this.bindRequestContext(req);
      return true;
    }

    const ok = (await super.canActivate(context)) as boolean;
    this.bindRequestContext(req);
    return ok;
  }

  /** Ghi userId/workspaceId vào AsyncLocalStorage của request để log/audit đọc được ở mọi tầng. */
  private bindRequestContext(req: AuthedRequest): void {
    const store = getStore();
    if (store && req.user) {
      store.userId = req.user.id;
      store.workspaceId = req.user.workspaceId;
    }
  }
}
