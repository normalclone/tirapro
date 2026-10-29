import { HttpException, Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PayloadTooLargeException } from '@nestjs/common';
import {
  AllExceptionsFilter,
  FILE_TOO_LARGE_MESSAGE,
  INTERNAL_ERROR_MESSAGE,
} from './all-exceptions.filter';

// Lỗi 500 trong test sẽ in stack ra console — tắt cho gọn.
Logger.overrideLogger(false);

interface ErrBody {
  error: { code?: string; message: string; requestId?: string };
}

function run(exception: unknown) {
  const json = vi.fn<(b: ErrBody) => void>();
  const res = { status: vi.fn<(c: number) => unknown>().mockReturnThis(), json };
  const req = { id: 'req-123', method: 'GET', url: '/x' };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  };
  new AllExceptionsFilter().catch(exception, host as never);
  return { status: res.status.mock.calls[0]?.[0], body: json.mock.calls[0]![0] };
}

describe('AllExceptionsFilter', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prod: lỗi không phải HttpException → thông báo chung + requestId, không lộ message nội bộ', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { status, body } = run(new Error('relation "users" does not exist'));
    expect(status).toBe(500);
    expect(body.error.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(body.error.requestId).toBe('req-123');
    expect(JSON.stringify(body)).not.toContain('relation');
  });

  it('dev: giữ message gốc để dễ debug', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { body } = run(new Error('boom'));
    expect(body.error.message).toBe('boom');
  });

  it('HttpException vẫn giữ nguyên message ở prod', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { status, body } = run(new HttpException('Không tìm thấy', 404));
    expect(status).toBe(404);
    expect(body.error.message).toBe('Không tìm thấy');
  });

  it('413 từ multer (File too large) → mã PAYLOAD_TOO_LARGE + thông báo tiếng Việt', () => {
    const { status, body } = run(new PayloadTooLargeException('File too large'));
    expect(status).toBe(413);
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error.message).toBe(FILE_TOO_LARGE_MESSAGE);
  });

  it('413 với message khác (vd attachments tự ném) giữ nguyên message, chỉ đổi mã', () => {
    const { body } = run(new PayloadTooLargeException('Tệp vượt 25MB'));
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error.message).toBe('Tệp vượt 25MB');
  });
});
