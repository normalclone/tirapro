import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { hashApiKeySecret, isLegacyArgon2Hash, verifyApiKeySecret } from './api-key-hash';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { offsetPage } from '../../common/dto/page-result';
import type { CreateApiKeyInput } from './api-keys.schemas';

export type ApiScope = 'read' | 'write';

/** Ngữ cảnh khi xác thực bằng API key (guard gắn vào request). */
export interface ApiKeyContext {
  keyId: string;
  userId: string;
  workspaceId: string;
  email: string;
  displayName: string;
  scopes: ApiScope[];
}

const KEY_PREFIX = 'tira';
const KEY_RE = /^tira_([0-9a-f]{6,})_([0-9a-f]{16,})$/i;
const TOUCH_INTERVAL_MS = 60_000;
const CACHE_TTL_SEC = 60;
const cacheKey = (prefix: string) => `apikey:ctx:${prefix}`;

/** Bản ghi cache: hash secret đã xác thực + ngữ cảnh. Chỉ lưu sau khi verify thành công. */
interface CachedCtx {
  h: string;
  exp: number | null;
  ctx: ApiKeyContext;
}

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

/**
 * Quản lý API key (PAT) cho tích hợp ngoài & MCP.
 * Chỉ lưu HASH (sha256; key cũ là argon2 vẫn dùng được) của secret; plaintext trả về DUY NHẤT 1 lần lúc tạo.
 */
@Injectable()
export class ApiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private gen() {
    const prefix = randomBytes(5).toString('hex'); // 10 hex
    const secret = randomBytes(24).toString('hex'); // 48 hex
    return { prefix, secret, full: `${KEY_PREFIX}_${prefix}_${secret}` };
  }

  private toDto(r: KeyRow) {
    return {
      id: r.id,
      name: r.name,
      prefix: `${KEY_PREFIX}_${r.prefix}`,
      scopes: r.scopes,
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      revoked: r.revokedAt != null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async list(workspaceId: string) {
    const rows = await this.prisma.apiKey.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    const data = rows.map((r) => this.toDto(r));
    return offsetPage(data, 1, Math.max(1, data.length), data.length);
  }

  async create(workspaceId: string, userId: string, input: CreateApiKeyInput) {
    const { prefix, secret, full } = this.gen();
    const hash = hashApiKeySecret(secret);
    const scopes: ApiScope[] = input.write ? ['read', 'write'] : ['read'];
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null;
    const rec = await this.prisma.apiKey.create({
      data: { workspaceId, userId, name: input.name, prefix, hash, scopes, expiresAt },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    // key đầy đủ chỉ trả về lần này
    return { ...this.toDto(rec), key: full };
  }

  async revoke(id: string, workspaceId: string) {
    const found = await this.prisma.apiKey.findFirst({
      where: { id, workspaceId },
      select: { id: true, prefix: true },
    });
    if (!found) throw new NotFoundAppException('Khoá API');
    await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.dropCache(found.prefix); // thu hồi có hiệu lực ngay, không đợi hết TTL
    return { ok: true as const };
  }

  /**
   * Thu hồi MỌI key còn hiệu lực của user trong workspace (khi gỡ thành viên). Nhận client giao dịch để
   * chạy cùng transaction với việc xoá membership; trả về prefix để gọi `dropCaches` SAU khi commit.
   */
  async revokeAllForUser(
    workspaceId: string,
    userId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string[]> {
    const keys = await db.apiKey.findMany({
      where: { workspaceId, userId, revokedAt: null },
      select: { prefix: true },
    });
    if (keys.length === 0) return [];
    await db.apiKey.updateMany({
      where: { workspaceId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return keys.map((k) => k.prefix);
  }

  /** Xoá cache xác thực của các key vừa thu hồi để có hiệu lực ngay, không đợi hết TTL. */
  async dropCaches(prefixes: string[]): Promise<void> {
    await Promise.all(prefixes.map((p) => this.dropCache(p)));
  }

  /**
   * Xoá cache xác thực của MỌI key (mọi workspace) của một user — gọi khi tài khoản bị vô hiệu hoá để key chặn NGAY,
   * không đợi hết TTL 60s. Không thu hồi key: mở khoá tài khoản thì key dùng lại được (validate kiểm `user.status`).
   */
  async dropCachesForUser(userId: string): Promise<void> {
    const keys = await this.prisma.apiKey.findMany({
      where: { userId, revokedAt: null },
      select: { prefix: true },
    });
    await this.dropCaches(keys.map((k) => k.prefix));
  }

  /** Xác thực raw key → ngữ cảnh, hoặc null nếu không hợp lệ. */
  async validate(raw: string): Promise<ApiKeyContext | null> {
    const m = KEY_RE.exec(raw.trim());
    if (!m) return null;
    const [, prefix, secret] = m;
    const secretHash = hashApiKeySecret(secret!);

    // Cache 60s (bỏ qua nếu không có Redis). Chỉ trúng khi đúng secret — so hash, không tin riêng prefix.
    const cached = await this.readCache(prefix!);
    if (cached && cached.h === secretHash && (cached.exp == null || cached.exp > Date.now())) {
      return cached.ctx;
    }

    const key = await this.prisma.apiKey.findUnique({
      where: { prefix: prefix! },
      select: {
        id: true,
        hash: true,
        scopes: true,
        workspaceId: true,
        userId: true,
        revokedAt: true,
        expiresAt: true,
        user: { select: { email: true, displayName: true, status: true } },
      },
    });
    if (!key || key.revokedAt) return null;
    if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;
    if (key.user.status === 'DEACTIVATED') return null;
    // Chủ key đã bị gỡ khỏi workspace thì key không còn dùng được (kể cả khi chưa kịp bị thu hồi).
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: key.workspaceId, userId: key.userId } },
      select: { id: true },
    });
    if (!membership) return null;
    const ok = await verifyApiKeySecret(key.hash, secret!);
    if (!ok) return null;
    void this.touch(key.id, key.expiresAt); // lastUsedAt (fire-and-forget)
    if (isLegacyArgon2Hash(key.hash)) void this.upgradeHash(key.id, secretHash); // key cũ → sha256, lần sau không tốn argon2
    const ctx: ApiKeyContext = {
      keyId: key.id,
      userId: key.userId,
      workspaceId: key.workspaceId,
      email: key.user.email,
      displayName: key.user.displayName,
      scopes: key.scopes as ApiScope[],
    };
    await this.writeCache(prefix!, { h: secretHash, exp: key.expiresAt?.getTime() ?? null, ctx });
    return ctx;
  }

  private async readCache(prefix: string): Promise<CachedCtx | null> {
    const client = this.redis.isAvailable() ? this.redis.getClient() : null;
    if (!client) return null;
    try {
      const raw = await client.get(cacheKey(prefix));
      return raw ? (JSON.parse(raw) as CachedCtx) : null;
    } catch {
      return null;
    }
  }

  private async writeCache(prefix: string, value: CachedCtx): Promise<void> {
    const client = this.redis.isAvailable() ? this.redis.getClient() : null;
    if (!client) return;
    await client
      .set(cacheKey(prefix), JSON.stringify(value), 'EX', CACHE_TTL_SEC)
      .catch(() => undefined);
  }

  private async dropCache(prefix: string): Promise<void> {
    const client = this.redis.isAvailable() ? this.redis.getClient() : null;
    if (!client) return;
    await client.del(cacheKey(prefix)).catch(() => undefined);
  }

  private async upgradeHash(id: string, hash: string): Promise<void> {
    await this.prisma.apiKey.update({ where: { id }, data: { hash } }).catch(() => undefined);
  }

  private async touch(id: string, _expiresAt: Date | null) {
    // Chỉ cập nhật khi cách lần trước > 1 phút để giảm ghi.
    await this.prisma.apiKey
      .updateMany({
        where: {
          id,
          OR: [
            { lastUsedAt: null },
            { lastUsedAt: { lt: new Date(Date.now() - TOUCH_INTERVAL_MS) } },
          ],
        },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => undefined);
  }
}
