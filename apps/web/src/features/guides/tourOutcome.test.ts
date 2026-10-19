import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureSkipButton, restoreTourFocus, SKIP_LABEL, tourOutcome } from './tourOutcome';

describe('tourOutcome — hoàn thành hay chỉ đã xem', () => {
  it('chỉ "complete" khi đã tới và xác nhận bước cuối bằng "Xong"', () => {
    expect(tourOutcome({ reachedLast: true, finishedViaDone: true })).toBe('complete');
  });
  it('Bỏ qua / × / Esc / bấm nền = seen, kể cả khi đã xem tới bước cuối', () => {
    expect(tourOutcome({ reachedLast: true, finishedViaDone: false })).toBe('seen');
    expect(tourOutcome({ reachedLast: false, finishedViaDone: false })).toBe('seen');
  });
  it('"Xong" mà chưa tới bước cuối là không thể; vẫn không tính hoàn thành', () => {
    expect(tourOutcome({ reachedLast: false, finishedViaDone: true })).toBe('seen');
  });
});

/** Phần tử giả tối thiểu (test node, không jsdom). */
function fakeDoc() {
  const created: FakeBtn[] = [];
  return {
    created,
    createElement(tag: string) {
      const b = new FakeBtn(tag);
      created.push(b);
      return b as unknown as HTMLButtonElement;
    },
  };
}
class FakeBtn {
  attrs: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  className = '';
  textContent = '';
  type = '';
  constructor(public tag: string) {}
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  addEventListener(ev: string, fn: () => void) {
    this.listeners[ev] = fn;
  }
}
function fakeFooter() {
  const children: unknown[] = ['progress', 'buttons'];
  return {
    children,
    firstChild: children[0],
    querySelector: (sel: string) =>
      sel === '[data-tour-skip]' ? (children.find((c) => c instanceof FakeBtn) ?? null) : null,
    insertBefore(n: unknown, ref: unknown) {
      children.splice(children.indexOf(ref), 0, n);
      this.firstChild = children[0];
    },
  };
}

describe('ensureSkipButton', () => {
  it('chèn <button type="button"> "Bỏ qua" làm phần tử ĐẦU của footer, gọi onSkip khi bấm', () => {
    const doc = fakeDoc();
    const footer = fakeFooter();
    let skipped = 0;
    ensureSkipButton(footer, doc, () => skipped++);
    const b = footer.children[0] as FakeBtn;
    expect(b).toBeInstanceOf(FakeBtn);
    expect(b.tag).toBe('button');
    expect(b.type).toBe('button');
    expect(b.textContent).toBe(SKIP_LABEL);
    expect(SKIP_LABEL).toBe('Bỏ qua');
    expect(b.attrs['data-tour-skip']).toBe('');
    expect(b.className).toContain('tour-skip-btn');
    b.listeners.click!();
    expect(skipped).toBe(1);
  });
  it('idempotent: gọi lại không nhân đôi nút', () => {
    const doc = fakeDoc();
    const footer = fakeFooter();
    ensureSkipButton(footer, doc, () => {});
    ensureSkipButton(footer, doc, () => {});
    expect(footer.children.filter((c) => c instanceof FakeBtn)).toHaveLength(1);
    expect(doc.created).toHaveLength(1);
  });
});

describe('restoreTourFocus', () => {
  const el = (connected: boolean) => {
    const calls: unknown[] = [];
    return { isConnected: connected, focus: (o: unknown) => calls.push(o), calls };
  };
  it('trả focus về phần tử đã mở tour nếu còn trong DOM', () => {
    const opener = el(true);
    const main = el(true);
    restoreTourFocus(opener, main);
    expect(opener.calls).toHaveLength(1);
    expect(main.calls).toHaveLength(0);
  });
  it('không có / đã gỡ khỏi DOM (auto-start, Cmd+K) → về <main>', () => {
    const main = el(true);
    restoreTourFocus(null, main);
    expect(main.calls).toHaveLength(1);
    const gone = el(false);
    const main2 = el(true);
    restoreTourFocus(gone, main2);
    expect(gone.calls).toHaveLength(0);
    expect(main2.calls).toHaveLength(1);
  });
  it('không có gì để focus → không lỗi', () => {
    expect(() => restoreTourFocus(null, null)).not.toThrow();
  });
});

describe('GuideLauncher — nối dây', () => {
  const WEB = join(__dirname, '../../..');
  const gl = readFileSync(join(__dirname, 'GuideLauncher.tsx'), 'utf8');
  it('nhãn "Quay lại"/"Tiếp"/"Xong", tiến độ n/N; không còn "Trước"', () => {
    expect(gl).toContain("prevBtnText: 'Quay lại'");
    expect(gl).toContain("nextBtnText: 'Tiếp'");
    expect(gl).toContain("doneBtnText: 'Xong'");
    expect(gl).toContain("progressText: '{{current}}/{{total}}'");
    expect(gl).not.toContain("'Trước'");
  });
  it('chèn "Bỏ qua" qua onPopoverRender (mỗi bước), bấm → driver.destroy()', () => {
    expect(gl).toContain('onPopoverRender');
    expect(gl).toMatch(/ensureSkipButton\(popover\.footer/);
    expect(gl).toMatch(/driver\.destroy\(\)/);
  });
  it('"Xong" ghi nhận qua onNextClick ở bước cuối; kết quả do tourOutcome quyết định, không còn complete cứng', () => {
    expect(gl).toContain('onNextClick');
    expect(gl).toContain('isLastStep()');
    expect(gl).toContain('tourOutcome(');
    expect(gl).not.toMatch(/action: 'complete'/);
  });
  it('trả focus khi tour đóng và nhớ phần tử đã mở', () => {
    expect(gl).toContain('restoreTourFocus(');
    expect(gl).toContain('returnFocus');
  });
  it('CSS: nút Bỏ qua dạng chữ + vùng bấm ≥ 44px trên cảm ứng, dùng token có sẵn', () => {
    expect(gl).toMatch(/\.driver-popover-footer \.tour-skip-btn\s*\{/);
    expect(gl).toMatch(/@media \(pointer: coarse\)[\s\S]*min-height: 44px/);
    expect(gl).toContain('var(--ink)');
  });
  it('<main> focus được bằng mã (tabIndex -1, không viền) để tour tự chạy trả focus về đó', () => {
    const shell = readFileSync(join(WEB, 'src/components/layout/AppShell.tsx'), 'utf8');
    expect(shell).toMatch(/<main\s+tabIndex=\{-1\}[\s\S]*?focus:outline-none/);
  });
  it('không thêm phụ thuộc: package.json vẫn driver.js ^1.3.5 (không đổi)', () => {
    const pkg = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['driver.js']).toBe('^1.3.5');
  });
});
