import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
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

type KeyRow = {
  id: string; name: string; prefix: string; scopes: string[];
  lastUsedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null; createdAt: Date;
};

/**
 * Quản lý API key (PAT) cho tích hợp ngoài & MCP.
 * Chỉ lưu HASH (argon2) của secret; plaintext trả về DUY NHẤT 1 lần lúc tạo.
 */
@Injectable()
export class ApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

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
      select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true },
    });
    const data = rows.map((r) => this.toDto(r));
    return offsetPage(data, 1, Math.max(1, data.length), data.length);
  }

  async create(workspaceId: string, userId: string, input: CreateApiKeyInput) {
    const { prefix, secret, full } = this.gen();
    const hash = await argon2.hash(secret);
    const scopes: ApiScope[] = input.write ? ['read', 'write'] : ['read'];
    const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
    const rec = await this.prisma.apiKey.create({
      data: { workspaceId, userId, name: input.name, prefix, hash, scopes, expiresAt },
      select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true },
    });
    // key đầy đủ chỉ trả về lần này
    return { ...this.toDto(rec), key: full };
  }

  async revoke(id: string, workspaceId: string) {
    const found = await this.prisma.apiKey.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!found) throw new NotFoundAppException('API key');
    await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    return { ok: true as const };
  }

  /** Xác thực raw key → ngữ cảnh, hoặc null nếu không hợp lệ. */
  async validate(raw: string): Promise<ApiKeyContext | null> {
    const m = KEY_RE.exec(raw.trim());
    if (!m) return null;
    const [, prefix, secret] = m;
    const key = await this.prisma.apiKey.findUnique({
      where: { prefix: prefix! },
      select: {
        id: true, hash: true, scopes: true, workspaceId: true, userId: true, revokedAt: true, expiresAt: true,
        user: { select: { email: true, displayName: true, status: true } },
      },
    });
    if (!key || key.revokedAt) return null;
    if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;
    if (key.user.status === 'DEACTIVATED') return null;
    const ok = await argon2.verify(key.hash, secret!).catch(() => false);
    if (!ok) return null;
    void this.touch(key.id, key.expiresAt); // lastUsedAt (fire-and-forget)
    return {
      keyId: key.id,
      userId: key.userId,
      workspaceId: key.workspaceId,
      email: key.user.email,
      displayName: key.user.displayName,
      scopes: key.scopes as ApiScope[],
    };
  }

  private async touch(id: string, _expiresAt: Date | null) {
    // Chỉ cập nhật khi cách lần trước > 1 phút để giảm ghi.
    await this.prisma.apiKey
      .updateMany({
        where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(Date.now() - TOUCH_INTERVAL_MS) } }] },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => undefined);
  }
}
