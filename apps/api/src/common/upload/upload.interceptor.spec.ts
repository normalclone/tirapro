import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { of } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeUploadInterceptor } from './upload.interceptor';

/** Dựng server HTTP thật + multer thật để kiểm giới hạn dung lượng (M5). */
function appWith(interceptor: { intercept: (c: never, n: never) => Promise<unknown> }): Server {
  return createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const ctx = new ExecutionContextHost([req, res]);
    interceptor
      .intercept(ctx as never, { handle: () => of('ok') } as never)
      .then(() => {
        const f = (req as unknown as { file?: { size: number; originalname: string } }).file;
        send(200, { size: f?.size, name: f?.originalname });
      })
      .catch((e: { getStatus?: () => number; getResponse?: () => unknown; message: string }) =>
        send(e.getStatus?.() ?? 500, e.getResponse?.() ?? { message: e.message }),
      );
  });
}

describe('makeUploadInterceptor — multer limits.fileSize (M5)', () => {
  let server: Server;
  let base = '';
  beforeAll(async () => {
    const Cls = makeUploadInterceptor('attachment');
    const interceptor = new Cls({
      get: (k: string) => (k === 'storage.maxFileSizeMb' ? 1 : undefined),
    });
    server = appWith(interceptor as never).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
  });

  const send = (bytes: number, name = 'a.bin') => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(bytes)]), name);
    return fetch(`${base}/up`, { method: 'POST', body: fd });
  };

  it('tệp trong giới hạn đi qua; multer nhận được tệp', async () => {
    const r = await send(1000);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { size: number }).size).toBe(1000);
  });

  it('tệp vượt MAX_FILE_SIZE_MB bị cắt NGAY ở multer, báo đúng thông điệp nghiệp vụ cũ (422)', async () => {
    const r = await send(1024 * 1024 + 10);
    expect(r.status).toBe(422);
    const body = (await r.json()) as { message: string };
    expect(body.message).toBe('Tệp vượt quá kích thước tối đa 1MB');
  });

  it('avatar: giới hạn cố định 5MB, thông điệp theo ảnh', async () => {
    const Cls = makeUploadInterceptor('avatar');
    const app = appWith(new Cls({ get: () => 25 }) as never).listen(0);
    await new Promise((r) => app.once('listening', r));
    const url = `http://127.0.0.1:${(app.address() as AddressInfo).port}/up`;
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]), 'a.png');
    const r = await fetch(url, { method: 'POST', body: fd });
    app.close();
    expect(r.status).toBe(422);
    expect(((await r.json()) as { message: string }).message).toBe('Ảnh vượt quá 5MB');
  });
});
