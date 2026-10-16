/** Cache trong bộ nhớ với TTL cố định và trần số mục (đầy thì dọn mục hết hạn, vẫn đầy thì xoá hết). */
export class TtlCache<T> {
  private readonly items = new Map<string, { at: number; value: T }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  /** Giá trị còn hạn (< `ttlMs` kể từ lúc ghi) hoặc `undefined`. */
  read(key: string, now = Date.now()): T | undefined {
    const hit = this.items.get(key);
    return hit && now - hit.at < this.ttlMs ? hit.value : undefined;
  }

  put(key: string, value: T, now = Date.now()): void {
    if (this.items.size >= this.maxEntries) {
      for (const [k, v] of this.items) if (now - v.at >= this.ttlMs) this.items.delete(k);
      if (this.items.size >= this.maxEntries) this.items.clear();
    }
    this.items.set(key, { at: now, value });
  }

  get size(): number {
    return this.items.size;
  }
}
