import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { PageResult } from '../dto/page-result';
import type { AuthedRequest } from '../types/request';

/**
 * Bọc kết quả list (PageResult) thành envelope { success, data, pageInfo, meta }.
 * Single resource trả raw object (theo cross-cutting decision §4.3).
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const meta = () => ({ requestId: req.id, timestamp: new Date().toISOString() });

    return next.handle().pipe(
      map((payload) => {
        if (payload instanceof PageResult) {
          return { success: true, data: payload.data, pageInfo: payload.pageInfo, meta: meta() };
        }
        return payload;
      }),
    );
  }
}
