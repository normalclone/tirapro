import { Injectable, NestMiddleware } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import type { NextFunction, Response } from 'express';
import type { AuthedRequest } from '../types/request';

/** Gắn request id (header X-Request-Id hoặc sinh mới) để xuyên suốt log/REST/WS. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: AuthedRequest, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    req.id = incoming && incoming.length <= 64 ? incoming : createId();
    res.setHeader('X-Request-Id', req.id);
    next();
  }
}
