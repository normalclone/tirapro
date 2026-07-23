import { ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { ApiKeyService } from '../../api-keys/api-key.service';
import type { AuthedRequest } from '../../../common/types/request';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Rút API key từ header: `X-API-Key: tira_…` hoặc `Authorization: Bearer tira_…`. */
function extractApiKey(req: AuthedRequest): string | null {
  const x = req.headers['x-api-key'];
  if (typeof x === 'string' && x.startsWith('tira_')) return x;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer tira_')) return auth.slice('Bearer '.length);
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
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest & { apiKey?: { id: string; scopes: string[] } }>();
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
        throw new ForbiddenException('API key chỉ có quyền đọc (read-only)');
      }
      return true;
    }

    return (await super.canActivate(context)) as boolean;
  }
}
