/**
 * Semaphore dùng chung trong một tiến trình, có HẠN CHỜ: không ai chờ chỗ vô hạn.
 * Dùng để chặn tổng số việc nặng chạy cùng lúc giữa MỌI request (vd đếm gợi ý nới bộ lọc giữ một kết nối DB mỗi lần),
 * thay vì chỉ giới hạn trong từng request.
 */
export class Semaphore {
  private free: number;
  private readonly queue: Array<{
    grant: (release: () => void) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(private readonly max: number) {
    this.free = max;
  }

  /** Tổng số chỗ. */
  get capacity(): number {
    return this.max;
  }

  /** Số chỗ đang bị giữ. */
  get inFlight(): number {
    return this.max - this.free;
  }

  /** Số người đang chờ chỗ. */
  get waiting(): number {
    return this.queue.length;
  }

  /**
   * Xin một chỗ, chờ tối đa đến `deadlineAt` (ms epoch). Trả hàm nhả chỗ (gọi nhiều lần chỉ nhả một), hoặc `null` nếu
   * đã/được quá hạn mà chưa có chỗ — khi đó KHÔNG chiếm chỗ nào.
   */
  acquire(deadlineAt: number): Promise<(() => void) | null> {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) return Promise.resolve(null);
    if (this.free > 0) {
      this.free--;
      return Promise.resolve(this.makeRelease());
    }
    return new Promise((resolve) => {
      const entry = {
        grant: (release: () => void) => resolve(release),
        timer: setTimeout(() => {
          const i = this.queue.indexOf(entry);
          if (i >= 0) this.queue.splice(i, 1);
          resolve(null);
        }, remaining),
      };
      this.queue.push(entry);
    });
  }

  private makeRelease(): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.queue.shift();
      if (next) {
        clearTimeout(next.timer);
        next.grant(this.makeRelease()); // chỗ chuyển thẳng cho người chờ lâu nhất
      } else {
        this.free++;
      }
    };
  }
}
