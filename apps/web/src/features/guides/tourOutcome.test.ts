import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyGuideProgress,
  createTourFlow,
  ensureSkipButton,
  restoreTourFocus,
  shouldFocusPrimary,
  SKIP_LABEL,
  tourOutcome,
} from './tourOutcome';

describe('tourOutcome — hoàn thành hay chỉ đã xem', () => {
  it('"complete" chỉ khi đã xác nhận bước cuối bằng "Xong"; còn lại là "seen"', () => {
    expect(tourOutcome({ finishedViaDone: true })).toBe('complete');
    expect(tourOutcome({ finishedViaDone: false })).toBe('seen');
  });
});

/**
 * Mô phỏng driver.js ở mức hành vi: `activeIndex` đổi NGAY khi moveNext (trước hiệu ứng ~400ms, lúc popover đã bấm được
 * từ ~200ms) và KHÔNG có sự kiện `onHighlighted` — đúng thứ tạo ra race cũ (cờ "đã tới bước cuối" đặt muộn).
 */
function simulate(
  total: number,
  actions: ('next' | 'arrowRight' | 'skip' | 'esc' | 'close' | 'overlay')[],
) {
  const flow = createTourFlow();
  let index = 0;
  let destroyed = false;
  const isLast = () => index === total - 1;
  const destroy = () => {
    destroyed = true;
  };
  // Cùng một handler cho nút "Tiếp/Xong" VÀ phím → (driver.js gọi onNextClick cho cả hai).
  const onNextClick = () => {
    if (flow.next(isLast()) === 'finish') destroy();
    else index += 1;
  };
  for (const a of actions) {
    if (destroyed) break;
    if (a === 'next' || a === 'arrowRight') onNextClick();
    else destroy(); // skip / esc / close / overlay: đóng không qua onNextClick
  }
  return { destroyed, outcome: flow.outcome() };
}

describe('luồng tour (hành vi, không phụ thuộc thời gian hiệu ứng)', () => {
  it('bước cuối → bấm "Xong" NGAY (không chờ onHighlighted) → complete', () => {
    expect(simulate(3, ['next', 'next', 'next'])).toEqual({ destroyed: true, outcome: 'complete' });
  });
  it('nhảy liền các bước nhanh tới Xong vẫn complete', () => {
    expect(simulate(4, ['next', 'next', 'next', 'next']).outcome).toBe('complete');
  });
  it('tour một bước: Xong ngay → complete', () => {
    expect(simulate(1, ['next']).outcome).toBe('complete');
  });
  it('ArrowRight ở bước cuối được tính là hoàn thành (bàn phím tương đương Tiếp/Xong — chủ ý)', () => {
    expect(simulate(2, ['arrowRight', 'arrowRight'])).toEqual({
      destroyed: true,
      outcome: 'complete',
    });
  });
  it('ArrowRight giữa chừng chỉ đi tiếp, chưa đóng', () => {
    expect(simulate(3, ['arrowRight'])).toEqual({ destroyed: false, outcome: 'seen' });
  });
  it('Bỏ qua / Esc / × / bấm nền = seen, kể cả khi đang ở bước cuối', () => {
    for (const a of ['skip', 'esc', 'close', 'overlay'] as const) {
      expect(simulate(3, [a]).outcome).toBe('seen');
      expect(simulate(3, ['next', 'next', a]).outcome).toBe('seen');
    }
  });
  it('createTourFlow.next trả finish chỉ ở bước cuối', () => {
    const f = createTourFlow();
    expect(f.next(false)).toBe('move');
    expect(f.outcome()).toBe('seen');
    expect(f.next(true)).toBe('finish');
    expect(f.outcome()).toBe('complete');
  });
});

describe('applyGuideProgress — cập nhật cache sau khi đánh dấu', () => {
  const g = (key: string, seen: boolean, state: string | null) => ({ key, seen, state, x: 1 });
  it('seen: đặt seen=true, state SEEN nếu chưa có', () => {
    expect(applyGuideProgress([g('a', false, null), g('b', false, null)], 'a', 'seen')).toEqual([
      g('a', true, 'SEEN'),
      g('b', false, null),
    ]);
  });
  it('seen KHÔNG hạ cấp COMPLETED (như API)', () => {
    expect(applyGuideProgress([g('a', true, 'COMPLETED')], 'a', 'seen')[0]!.state).toBe(
      'COMPLETED',
    );
  });
  it('complete: COMPLETED', () => {
    expect(applyGuideProgress([g('a', true, 'SEEN')], 'a', 'complete')[0]).toEqual(
      g('a', true, 'COMPLETED'),
    );
  });
  it('khoá lạ → giữ nguyên (cùng tham chiếu mục)', () => {
    const list = [g('a', false, null)];
    expect(applyGuideProgress(list, 'zzz', 'seen')[0]).toBe(list[0]);
  });
});

describe('shouldFocusPrimary — focus nút chính, không cướp từ phần tử đang nổi bật', () => {
  it('focus đang ở trong popover hoặc ở body → chuyển về nút chính', () => {
    expect(shouldFocusPrimary({ activeInPopover: true, activeIsBody: false })).toBe(true);
    expect(shouldFocusPrimary({ activeInPopover: false, activeIsBody: true })).toBe(true);
  });
  it('focus đang ở nơi khác (vd ô nhập của phần tử được chỉ tới) → không đụng', () => {
    expect(shouldFocusPrimary({ activeInPopover: false, activeIsBody: false })).toBe(false);
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
  it('trả focus về phần tử đã mở tour (nút "?") nếu còn trong DOM', () => {
    const opener = el(true);
    restoreTourFocus(opener);
    expect(opener.calls).toHaveLength(1);
  });
  it('không có (auto-start, Cmd+K) hoặc đã gỡ khỏi DOM → không ép focus đi đâu (driver.js trả về body)', () => {
    const gone = el(false);
    restoreTourFocus(gone);
    expect(gone.calls).toHaveLength(0);
    expect(() => restoreTourFocus(null)).not.toThrow();
    expect(() => restoreTourFocus(undefined)).not.toThrow();
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
  it('"Xong" ghi nhận ngay trong onNextClick (createTourFlow), không còn cờ đặt ở onHighlighted', () => {
    expect(gl).toContain('onNextClick');
    expect(gl).toContain('isLastStep()');
    expect(gl).toContain('flow.next(');
    expect(gl).toContain('flow.outcome()');
    expect(gl).not.toContain('onHighlighted');
    expect(gl).not.toContain('reachedLast');
    expect(gl).not.toMatch(/action: 'complete'/);
  });
  it('ArrowRight ở bước cuối = hoàn thành: có chú thích rõ trong code', () => {
    expect(gl).toMatch(/ArrowRight[\s\S]{0,160}hoàn thành/);
  });
  it('mỗi lần render popover: focus nút chính (Tiếp/Xong) sau khi driver.js đặt focus, có kiểm shouldFocusPrimary', () => {
    expect(gl).toContain('shouldFocusPrimary(');
    expect(gl).toContain('popover.nextButton');
    expect(gl).toMatch(/requestAnimationFrame|setTimeout/);
  });
  it('CSS: nút × đạt 44px trên cảm ứng', () => {
    expect(gl).toMatch(
      /@media \(pointer: coarse\)[\s\S]*\.driver-popover-close-btn\s*\{[^}]*width: 44px[^}]*height: 44px/,
    );
  });
  it('trả focus khi tour đóng và nhớ phần tử đã mở', () => {
    expect(gl).toContain('restoreTourFocus(');
    expect(gl).toContain('returnFocus');
    expect(gl).not.toContain("querySelector<HTMLElement>('main')");
  });
  it('CSS: nút Bỏ qua dạng chữ + vùng bấm ≥ 44px trên cảm ứng, dùng token có sẵn', () => {
    expect(gl).toMatch(/\.driver-popover-footer \.tour-skip-btn\s*\{/);
    expect(gl).toMatch(/@media \(pointer: coarse\)[\s\S]*min-height: 44px/);
    expect(gl).toContain('var(--ink)');
  });
  it('<main> KHÔNG focus được (các chỗ kiểm "mất focus" so với body, forced-colors không viền)', () => {
    const shell = readFileSync(join(WEB, 'src/components/layout/AppShell.tsx'), 'utf8');
    expect(shell).not.toMatch(/<main[^>]*tabIndex/);
  });
  it('useMarkGuide cập nhật cache guides khi thành công (replay từ "?" không POST seen lần nữa)', () => {
    const api = readFileSync(join(__dirname, 'api.ts'), 'utf8');
    expect(api).toContain('onSuccess');
    expect(api).toContain('applyGuideProgress(');
    expect(api).toContain('setQueriesData');
  });
  it('không thêm phụ thuộc: package.json vẫn driver.js ^1.3.5 (không đổi)', () => {
    const pkg = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['driver.js']).toBe('^1.3.5');
  });
});
