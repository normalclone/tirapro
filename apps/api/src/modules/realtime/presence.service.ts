import { Injectable, Logger } from '@nestjs/common';
import type { PresenceUser } from '@tirapro/shared';
import { RedisService } from '../../infra/redis/redis.service';

/** Entry quá hạn nếu không có heartbeat (`presence:view`, client gửi mỗi 25s) trong 60s. */
export const PRESENCE_TTL_MS = 60_000;
/** TTL cả key hash — chỉ để Redis tự dọn room bị bỏ hoang; hạn từng entry do `ts` quyết định. */
const KEY_TTL_SECONDS = 300;

interface StoredEntry {
  displayName: string;
  avatarUrl: string | null;
  viewing: string | null;
  ts: number;
}

export interface PresenceProfile {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

const key = (room: string) => `presence:${room}`;

/**
 * Presence theo room: hash `presence:{room}` (userId → JSON{displayName,avatarUrl,viewing,ts}) trong Redis,
 * KHÔNG lưu DB. Entry hết hạn theo `ts` và được dọn khi đọc. Redis không có/lỗi → Map trong bộ nhớ
 * (đủ cho một node, dev) để tính năng vẫn chạy.
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private readonly memory = new Map<string, Map<string, StoredEntry>>();
  private warnedFallback = false;

  constructor(private readonly redis: RedisService) {}

  async join(room: string, profile: PresenceProfile): Promise<PresenceUser> {
    const entry: StoredEntry = {
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      viewing: null,
      ts: Date.now(),
    };
    // Vào lại (mở tab thứ hai) thì giữ `viewing` hiện có thay vì xoá.
    const existing = await this.get(room, profile.userId);
    if (existing) entry.viewing = existing.viewing;
    await this.put(room, profile.userId, entry);
    return toUser(profile.userId, entry);
  }

  async leave(room: string, userId: string): Promise<void> {
    const client = this.client();
    if (client) {
      try {
        await client.hdel(key(room), userId);
        return;
      } catch (err) {
        this.degrade(err);
      }
    }
    const hash = this.memory.get(room);
    hash?.delete(userId);
    if (hash && hash.size === 0) this.memory.delete(room);
  }

  /**
   * Cập nhật `viewing` (và làm mới `ts` — đây cũng là heartbeat). `changed` = giá trị viewing đổi thật,
   * để gateway chỉ phát lại state khi cần. Người chưa join → null.
   */
  async setViewing(
    room: string,
    userId: string,
    viewing: string | null,
  ): Promise<{ changed: boolean; user: PresenceUser } | null> {
    const current = await this.get(room, userId);
    if (!current || Date.now() - current.ts > PRESENCE_TTL_MS) return null;
    const next: StoredEntry = { ...current, viewing, ts: Date.now() };
    await this.put(room, userId, next);
    return { changed: current.viewing !== viewing, user: toUser(userId, next) };
  }

  /** Người đang có mặt (còn hạn). Entry quá hạn/hỏng bị xoá khỏi store. */
  async state(room: string): Promise<PresenceUser[]> {
    const all = await this.getAll(room);
    const now = Date.now();
    const alive: PresenceUser[] = [];
    const dead: string[] = [];
    for (const [userId, entry] of all) {
      if (entry && now - entry.ts <= PRESENCE_TTL_MS) alive.push(toUser(userId, entry));
      else dead.push(userId);
    }
    for (const userId of dead) await this.leave(room, userId);
    return alive;
  }

  // ---------- lưu trữ (Redis, rơi về Map) ----------
  private client() {
    return this.redis.isAvailable() ? this.redis.getClient() : null;
  }

  private degrade(err: unknown): void {
    if (this.warnedFallback) return;
    this.warnedFallback = true;
    this.logger.warn(`Presence: Redis lỗi, dùng bộ nhớ trong một node — ${err instanceof Error ? err.message : String(err)}`);
  }

  private async get(room: string, userId: string): Promise<StoredEntry | null> {
    const client = this.client();
    if (client) {
      try {
        return parseEntry(await client.hget(key(room), userId));
      } catch (err) {
        this.degrade(err);
      }
    }
    return this.memory.get(room)?.get(userId) ?? null;
  }

  private async put(room: string, userId: string, entry: StoredEntry): Promise<void> {
    const client = this.client();
    if (client) {
      try {
        await client.hset(key(room), userId, JSON.stringify(entry));
        await client.expire(key(room), KEY_TTL_SECONDS);
        return;
      } catch (err) {
        this.degrade(err);
      }
    }
    let hash = this.memory.get(room);
    if (!hash) this.memory.set(room, (hash = new Map<string, StoredEntry>()));
    hash.set(userId, entry);
  }

  private async getAll(room: string): Promise<Map<string, StoredEntry | null>> {
    const client = this.client();
    if (client) {
      try {
        const raw = await client.hgetall(key(room));
        return new Map(Object.entries(raw).map(([userId, json]) => [userId, parseEntry(json)]));
      } catch (err) {
        this.degrade(err);
      }
    }
    return new Map(this.memory.get(room) ?? []);
  }
}

function toUser(userId: string, e: StoredEntry): PresenceUser {
  return { userId, displayName: e.displayName, avatarUrl: e.avatarUrl, viewing: e.viewing };
}

function parseEntry(json: string | null): StoredEntry | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<StoredEntry>;
    if (typeof v.displayName !== 'string' || typeof v.ts !== 'number') return null;
    return { displayName: v.displayName, avatarUrl: v.avatarUrl ?? null, viewing: v.viewing ?? null, ts: v.ts };
  } catch {
    return null;
  }
}
