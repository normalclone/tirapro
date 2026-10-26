import { Readable } from 'node:stream';

/** Lỗi giống lỗi của AWS SDK v3 (đủ trường mà S3Storage đọc). */
export function awsError(name: string, httpStatusCode: number, message = name) {
  return Object.assign(new Error(message), { name, $metadata: { httpStatusCode } });
}

interface Stored {
  body: Buffer;
  contentType?: string;
  lastModified: Date;
}

/**
 * Client S3 giả trong bộ nhớ — chỉ hiểu các lệnh mà S3Storage dùng (nhận diện theo tên lớp lệnh).
 * `calls` ghi lại input của từng lệnh để test kiểm tham số (Bucket, ContentType, IfNoneMatch…).
 */
export class FakeS3Client {
  readonly objects = new Map<string, Stored>();
  readonly calls: { command: string; input: Record<string, unknown> }[] = [];
  /** Nếu đặt: mọi lệnh ném lỗi này (mô phỏng mạng đứt / timeout). */
  failWith: Error | null = null;
  /** Bucket được coi là tồn tại (HeadBucket). */
  buckets = new Set<string>(['bucket-test']);
  /** Bucket mà người gọi không có quyền (HeadBucket → 403). */
  forbiddenBuckets = new Set<string>();
  /** ListObjectsV2 trả 403 (policy không cho liệt kê). */
  forbidList = false;

  send(cmd: { constructor: { name: string }; input: Record<string, unknown> }): Promise<unknown> {
    const name = cmd.constructor.name;
    const input = cmd.input;
    this.calls.push({ command: name, input });
    if (this.failWith) return Promise.reject(this.failWith);
    const key = typeof input.Key === 'string' ? `${String(input.Bucket)}/${input.Key}` : '';
    switch (name) {
      case 'PutObjectCommand': {
        if (input.IfNoneMatch === '*' && this.objects.has(key))
          return Promise.reject(awsError('PreconditionFailed', 412));
        const body = Buffer.from(input.Body as Buffer);
        this.objects.set(key, {
          body,
          contentType: input.ContentType as string | undefined,
          lastModified: new Date(),
        });
        return Promise.resolve({ ETag: '"fake"' });
      }
      case 'GetObjectCommand': {
        const o = this.objects.get(key);
        if (!o) return Promise.reject(awsError('NoSuchKey', 404));
        return Promise.resolve({
          Body: Readable.from([o.body]),
          ContentLength: o.body.length,
          ContentType: o.contentType,
          LastModified: o.lastModified,
        });
      }
      case 'HeadObjectCommand': {
        const o = this.objects.get(key);
        if (!o) return Promise.reject(awsError('NotFound', 404));
        return Promise.resolve({
          ContentLength: o.body.length,
          ContentType: o.contentType,
          LastModified: o.lastModified,
        });
      }
      case 'DeleteObjectCommand':
        this.objects.delete(key);
        return Promise.resolve({});
      case 'ListObjectsV2Command': {
        if (this.forbidList) return Promise.reject(awsError('AccessDenied', 403));
        const pre = `${String(input.Bucket)}/${typeof input.Prefix === 'string' ? input.Prefix : ''}`;
        const strip = `${String(input.Bucket)}/`;
        const Contents = [...this.objects.entries()]
          .filter(([k]) => k.startsWith(pre))
          .map(([k, v]) => ({
            Key: k.slice(strip.length),
            Size: v.body.length,
            LastModified: v.lastModified,
          }));
        return Promise.resolve({ Contents, IsTruncated: false });
      }
      case 'HeadBucketCommand': {
        const b = String(input.Bucket);
        if (this.forbiddenBuckets.has(b)) return Promise.reject(awsError('Forbidden', 403));
        if (!this.buckets.has(b)) return Promise.reject(awsError('NotFound', 404));
        return Promise.resolve({});
      }
      default:
        return Promise.reject(new Error(`FakeS3Client: lệnh chưa hỗ trợ ${name}`));
    }
  }

  destroyed = false;
  destroy(): void {
    this.destroyed = true;
  }
}
