import { Injectable, NestMiddleware } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import type { IncomingMessage } from 'node:http';
import type { NextFunction, Response } from 'express';
import { requestContext } from '../context/request-context';
import type { AuthedRequest } from '../types/request';

/**
 * Lấy request id từ header `X-Request-Id` (≤ 64 ký tự) hoặc sinh mới.
 * Dùng chung cho middleware này và `genReqId` của pino-http để hai nơi luôn ra cùng một id.
 */
export function resolveRequestId(req: IncomingMessage): string {
  const incoming = req.headers['x-request-id'];
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  return value && value.length <= 64 ? value : createId();
}

/**
 * Gắn request id xuyên suốt log/REST/WS và mở AsyncLocalStorage cho request.
 * `userId/workspaceId` được JwtAuthGuard điền sau khi xác thực.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: AuthedRequest, res: Response, next: NextFunction): void {
    // pino-http có thể đã gán req.id trước (cùng hàm resolveRequestId) — giữ nguyên.
    req.id = req.id || resolveRequestId(req);
    res.setHeader('X-Request-Id', req.id);
    requestContext.run({ requestId: req.id, userId: undefined, workspaceId: undefined }, next);
  }
}
