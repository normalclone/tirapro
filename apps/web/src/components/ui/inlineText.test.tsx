import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AxiosError } from 'axios';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { wasErrorDescribed } from '@/lib/api';
import { SUMMARY_CONFLICT_MESSAGE, summaryErrorText } from '@/features/issues/IssueSummaryEdit';
import { SummaryConflictError, saveVersion } from '@/features/issues/summarySave';
import { InlineText } from './InlineText';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
const html = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <InlineText
      value="Sửa lỗi đăng nhập"
      label="Tiêu đề"
      canEdit
      onSave={() => Promise.resolve()}
      {...(extra as object)}
    />,
  );
const attr = (tag: string, n: string) => new RegExp(` ${n}="([^"]*)"`).exec(tag)?.[1];

describe('<InlineText> — chế độ xem', () => {
  it('có quyền: tiêu đề là <button type="button"> trong đúng MỘT thẻ tiêu đề; Tab/Enter/Space vào sửa', () => {
    const h = html({ as: 'h1' });
    expect(h.match(/<h1\b/g)).toHaveLength(1);
    expect(h).not.toContain('<h2');
    const heading = /<h1[^>]*>[\s\S]*?<\/h1>/.exec(h)![0];
    const btn = /<button[^>]*>/.exec(heading)![0];
    expect(attr(btn, 'type')).toBe('button');
    expect(heading).toContain('Sửa lỗi đăng nhập');
  });
  it('tên truy cập của tiêu đề chỉ là chữ tiêu đề: gợi ý "bấm để sửa" nằm NGOÀI thẻ tiêu đề, nối bằng aria-describedby', () => {
    const h = html();
    const heading = /<h2[^>]*>[\s\S]*?<\/h2>/.exec(h)![0];
    expect(heading).not.toContain('sr-only');
    expect(heading).not.toContain('Bấm hoặc nhấn Enter');
    const id = attr(/<button[^>]*>/.exec(heading)![0], 'aria-describedby')!;
    expect(h).toMatch(
      new RegExp(`<span id="${id}" class="sr-only">Bấm hoặc nhấn Enter để sửa tiêu đề</span>`),
    );
  });
  it('bút chì chỉ trang trí (aria-hidden), hiện khi rê/focus, luôn mờ trên cảm ứng; vùng chạm 44px trên cảm ứng', () => {
    const h = html();
    expect(h).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(h).toContain('group-hover:opacity-100');
    expect(h).toContain('group-focus-visible:opacity-100');
    expect(h).toContain('[@media(pointer:coarse)]:opacity-60');
    expect(/<button[^>]*>/.exec(h)![0]).toContain('[@media(pointer:coarse)]:min-h-11');
  });
  it('không có quyền: chỉ là chữ (không nút, không gợi ý sửa)', () => {
    const h = html({ canEdit: false });
    expect(h).not.toContain('<button');
    expect(h).not.toContain('Bấm hoặc nhấn Enter');
    expect(h).toContain('Sửa lỗi đăng nhập');
  });
  it('vùng SaveStatus (role=status) luôn có trong trang, kể cả khi idle', () => {
    expect(html()).toMatch(/<span[^>]*role="status"[^>]*aria-live="polite"/);
  });
  it('chế độ xem không vẽ ô nhập / ✓ / ✕', () => {
    const h = html();
    expect(h).not.toContain('<input');
    expect(h).not.toContain('aria-label="Lưu"');
  });
});

describe('<InlineText> — nguồn (ô sửa)', () => {
  const s = read('components/ui/InlineText.tsx');
  const hook = read('components/ui/useInlineEdit.ts');
  it('phím đi qua inlineKeyAction (shouldSubmitOnEnter dùng chung) + cờ vừa chốt chữ; không tự viết lại kiểm tra bộ gõ', () => {
    expect(s).toContain('inlineKeyAction(');
    expect(s).toContain('composed.take()');
    expect(s).toContain('onCompositionEnd={composed.onCompositionEnd}');
    expect(read('lib/inlineEdit.ts')).toContain('shouldSubmitOnEnter(');
    expect(s).not.toContain('229');
  });
  it('Esc huỷ: preventDefault khi đã dùng (panel / thanh chọn hàng loạt nhận biết qua defaultPrevented)', () => {
    expect(s).toMatch(/cancel\(\) !== before\) e\.preventDefault\(\)/);
  });
  it('✓ "Lưu" / ✕ "Huỷ": nút 44px cảm ứng (Button size=icon), mousedown giữ focus ô nhập để blur không lưu trước khi bấm Huỷ', () => {
    expect(s).toContain('aria-label="Lưu"');
    expect(s).toContain('aria-label="Huỷ"');
    expect(s.match(/size="icon"/g)!.length).toBeGreaterThanOrEqual(2);
    expect(s.match(/onMouseDown=\{keepFocus\}/g)!.length).toBeGreaterThanOrEqual(3); // ✓, ✕, vùng SaveStatus
    expect(read('components/ui/Button.tsx')).toContain(
      '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
    );
  });
  it('blur lưu CHỈ khi đang sửa (không tự gửi lại khi đang lỗi/đang lưu) và focus rời khỏi khối', () => {
    expect(s).toMatch(/phase !== 'editing'\) return/);
    expect(s).toContain('e.currentTarget.contains(e.relatedTarget)');
  });
  it('ô nhập: nhãn = label, maxLength, invalid + aria-describedby tới lời lỗi role=alert; chỉ-đọc khi đang lưu (giữ focus)', () => {
    expect(s).toContain('aria-label={label}');
    expect(s).toContain('maxLength={maxLength}');
    expect(s).toContain('readOnly={saving}');
    expect(s).toContain('invalid={message !== null}');
    expect(s).toContain('aria-describedby={message ? errId : undefined}');
    expect(s).toContain('role="alert"');
  });
  it('SaveStatus có "Thử lại" gửi lại giá trị lần cuối (retry)', () => {
    expect(s).toContain('<SaveStatus status={status} onRetry={retry} />');
    expect(hook).toContain("dispatch({ type: 'retry' })");
  });
  it('hook: trạng thái trong ref đồng bộ (Enter rồi blur không gửi đôi); onSave/version đọc qua ref', () => {
    expect(hook).toContain('stateRef.current = next');
    expect(hook).toContain('onSaveRef.current(next, attempt)');
    expect(hook).toMatch(/before !== 'saving' && next\.phase === 'saving'/);
  });
});

describe('IssueSummaryEdit — khoá lạc quan (OCC) và 409', () => {
  const s = read('features/issues/IssueSummaryEdit.tsx');
  it('mỗi lần lưu gửi version MỚI NHẤT của việc (qua ref lúc gửi), không phải bản chụp lúc mở ô', () => {
    expect(s).toContain('issueRef.current = issue');
    expect(s).toContain('latestVersion: () => issueRef.current.version');
  });
  const conflict = new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 409,
    data: { success: false, error: { code: 'VERSION_CONFLICT', message: 'gốc' } },
  } as never);
  it('409 VERSION_CONFLICT → lời báo xung đột nêu rõ lựa chọn Lưu (ghi đè) / Huỷ (giữ bản mới)', () => {
    expect(summaryErrorText(conflict)).toBe(SUMMARY_CONFLICT_MESSAGE);
    expect(SUMMARY_CONFLICT_MESSAGE).toMatch(/Người khác vừa sửa/);
    expect(SUMMARY_CONFLICT_MESSAGE).toMatch(/Lưu/);
    expect(SUMMARY_CONFLICT_MESSAGE).toMatch(/Huỷ/);
  });
  it('xung đột thật (tiêu đề đã đổi): nêu tiêu đề hiện tại trên máy chủ rồi mới tới lời báo chung', () => {
    const t = summaryErrorText(new SummaryConflictError('Bản của người khác'));
    expect(t).toContain('Tiêu đề vừa được đổi thành “Bản của người khác”');
    expect(t.endsWith(SUMMARY_CONFLICT_MESSAGE)).toBe(true);
  });
  it('lỗi khác → câu của apiErrorMessage; mọi nhánh đều đánh dấu "đã mô tả" để MutationCache không toast thêm', () => {
    const other = new AxiosError('x', 'ERR', undefined, undefined, {
      status: 400,
      data: { success: false, error: { code: 'VALIDATION_ERROR' } },
    } as never);
    expect(summaryErrorText(other)).toMatch(/chưa hợp lệ/);
    expect(wasErrorDescribed(other)).toBe(true);
    expect(wasErrorDescribed(conflict)).toBe(true);
  });
});

describe('nối dây: chi tiết (h1) và panel xem nhanh (h2)', () => {
  const detail = read('features/issues/IssueDetailPage.tsx');
  const peek = read('features/issues/peek/IssuePeekPanel.tsx');
  it('cả hai dùng IssueSummaryEdit; bản sao cũ đã xoá', () => {
    expect(detail).toContain('<IssueSummaryEdit');
    expect(peek).toContain('<IssueSummaryEdit');
    expect(peek).toMatch(/as="h2"/);
    expect(detail).not.toMatch(/summaryCancelled|saveSummary|setEditingSummary\(true\)/);
    expect(() => read('features/issues/peek/InlineSummary.tsx')).toThrow();
  });
  it('phím `e` và state điều hướng chỉ tăng yêu cầu mở (setter ổn định, không đóng gói closure cũ — P-C1)', () => {
    expect(detail.match(/setSummaryEditRequest\(\(n\) => n \+ 1\)/g)!.length).toBe(2);
    expect(detail).toContain('onEditingChange={setEditingSummary}');
    expect(detail).toContain('!editingSummary');
  });
});

describe('fix round 1', () => {
  const detail = read('features/issues/IssueDetailPage.tsx');
  const peek = read('features/issues/peek/IssuePeekPanel.tsx');
  const inline = read('components/ui/InlineText.tsx');
  const hook = read('components/ui/useInlineEdit.ts');
  const adapter = read('features/issues/IssueSummaryEdit.tsx');

  it('trang chi tiết (route issue/:key dùng lại trang) và peek: IssueSummaryEdit có key theo issue.id → đổi việc là ô sửa mới', () => {
    expect(detail).toMatch(/<IssueSummaryEdit\s+key=\{issue\.id\}/);
    expect(peek).toMatch(/<IssueSummaryEdit\s+key=\{issue\.id\}/);
  });

  describe('version khoá lạc quan: lần lưu đầu dùng version LÚC MỞ Ô', () => {
    it('saveVersion: lần đầu (attempt 0) = version đã chụp; sau lỗi (attempt ≥ 1) hoặc không có bản chụp = mới nhất', () => {
      expect(saveVersion({ captured: 3, latest: 5, attempt: 0 })).toBe(3);
      expect(saveVersion({ captured: 3, latest: 5, attempt: 1 })).toBe(5);
      expect(saveVersion({ captured: 3, latest: 5, attempt: 2 })).toBe(5);
      expect(saveVersion({ captured: null, latest: 5, attempt: 0 })).toBe(5);
      expect(saveVersion({ captured: 4, latest: 4, attempt: 0 })).toBe(4);
    });
    it('adapter chụp version + tiêu đề khi BẮT ĐẦU sửa (onEditStart) và lưu qua saveSummaryOnce (attempt, refetch)', () => {
      expect(adapter).toContain('onEditStart');
      expect(adapter).toMatch(
        /captured\.current = \{[\s\S]*version: issueRef\.current\.version[\s\S]*summary: issueRef\.current\.summary/,
      );
      expect(adapter).toContain('saveSummaryOnce(');
      expect(adapter).toMatch(/attempt,/);
      expect(adapter).not.toMatch(/version: cur\.version/);
    });
    it('409 ở lần đầu đi qua nạp lại bản mới (fetchQuery) và KHÔNG toast chung (silent); không vòng lặp', () => {
      expect(adapter).toContain('useUpdateIssue(issue.projectId, { silent: true })');
      expect(adapter).toContain('fetchQuery(');
      expect(adapter).toContain('startSummary');
    });
    it('hook gọi onEditStart ngay trong start() và chuyển attempt của máy trạng thái cho onSave', () => {
      expect(hook).toContain('onEditStartRef.current?.()');
      expect(hook).toContain('onSaveRef.current(next, attempt)');
      expect(hook).toMatch(/persist\(next\.value, next\.attempt\)/);
    });
  });

  it('khối sửa gắn data-inline-edit chỉ khi KHÔNG ở chế độ xem (phím tắt toàn cục bỏ qua ✓/✕/Thử lại)', () => {
    expect(inline).toContain("data-inline-edit={editing ? '' : undefined}");
    expect(html()).not.toContain('data-inline-edit');
  });
  it('trang chi tiết: phím i/y/e/1..9 cũng bỏ qua khi focus nằm trong khối sửa', () => {
    expect(detail).toContain("closest?.('[data-inline-edit]')");
  });
  it('sau lưu bằng blur, trả focus về tiêu đề KHÔNG cuộn trang', () => {
    expect(inline).toContain('viewRef.current?.focus({ preventScroll: true })');
  });
});
