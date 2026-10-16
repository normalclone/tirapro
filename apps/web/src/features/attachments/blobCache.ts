/**
 * Bộ nhớ đệm có giới hạn cho blob URL của ảnh đính kèm: mục dùng lâu nhất bị đẩy ra và `revoke`
 * (giải phóng bộ nhớ trình duyệt). Map giữ thứ tự chèn nên mục đầu tiên là mục cũ nhất.
 */
export class BlobUrlCache {
  private readonly map = new Map<string, string>();

  constructor(
    private readonly limit: number,
    private readonly revoke: (url: string) => void,
  ) {}

  get(key: string): string | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v); // dùng gần đây → xuống cuối hàng đợi
    }
    return v;
  }

  set(key: string, url: string): void {
    const old = this.map.get(key);
    if (old !== undefined) {
      this.map.delete(key);
      this.revoke(old);
    }
    this.map.set(key, url);
    while (this.map.size > this.limit) {
      const oldest = this.map.entries().next().value as [string, string];
      this.map.delete(oldest[0]);
      this.revoke(oldest[1]);
    }
  }

  /** Giải phóng và bỏ mọi blob URL (đăng xuất / đổi workspace). */
  clear(): void {
    for (const url of this.map.values()) this.revoke(url);
    this.map.clear();
  }
}
