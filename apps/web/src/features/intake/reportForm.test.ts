import { describe, expect, it } from 'vitest';
import {
  buildReportPayload,
  canSubmitReport,
  descriptionForMode,
  descriptionOnKindChange,
  environmentSummary,
  hasDraftContent,
  isReportTemplate,
  parseReportMode,
  severityForSubmit,
  reportDialogTitle,
  reportKindLabel,
  reportTemplate,
} from './reportForm';

const form = (o: Partial<Parameters<typeof buildReportPayload>[0]> = {}) => ({
  projectId: 'p1',
  kind: 'BUG' as const,
  summary: '  Nút đặt hàng không phản hồi ',
  description: '',
  severityId: '',
  environment: {},
  mergeIntoIssueId: null as string | null,
  forceNew: false,
  ...o,
});

describe('reportTemplate', () => {
  it('mỗi loại một mẫu; isReportTemplate nhận đúng mẫu', () => {
    expect(reportTemplate('BUG')).toContain('Các bước tái hiện');
    expect(reportTemplate('FEATURE')).toContain('Bạn muốn làm được gì');
    expect(reportTemplate('QUESTION')).toContain('Câu hỏi');
    expect(isReportTemplate(reportTemplate('BUG'))).toBe(true);
    expect(isReportTemplate('Mô tả của tôi')).toBe(false);
  });
});

describe('buildReportPayload', () => {
  it('trim tiêu đề, bỏ mô tả nếu chỉ là mẫu, bỏ severity/môi trường rỗng, chỉ Bug mới gửi severity+môi trường', () => {
    const p = buildReportPayload(
      form({
        description: reportTemplate('BUG'),
        severityId: '',
        environment: { browser: ' ', os: '' },
      }),
    );
    expect(p).toEqual({ projectId: 'p1', kind: 'BUG', summary: 'Nút đặt hàng không phản hồi' });
    const q = buildReportPayload(
      form({
        kind: 'FEATURE',
        severityId: 'sv1',
        environment: { browser: 'Chrome 126' },
        description: 'Cho đăng nhập Zalo',
      }),
    );
    expect(q).toEqual({
      projectId: 'p1',
      kind: 'FEATURE',
      summary: 'Nút đặt hàng không phản hồi',
      description: 'Cho đăng nhập Zalo',
    });
  });

  it('Bug: gửi severityId + environment đã chuẩn hoá; gộp thì kèm mergeIntoIssueId, "vẫn tạo mới" thì forceNew', () => {
    const b = buildReportPayload(
      form({
        severityId: 'sv1',
        environment: { browser: ' Chrome 126 ', env: 'staging' },
        mergeIntoIssueId: 'old1',
      }),
    );
    expect(b).toMatchObject({
      severityId: 'sv1',
      environment: { browser: 'Chrome 126', env: 'staging' },
      mergeIntoIssueId: 'old1',
    });
    expect(b).not.toHaveProperty('forceNew');
    expect(buildReportPayload(form({ forceNew: true }))).toMatchObject({ forceNew: true });
    expect(buildReportPayload(form({ forceNew: true }))).not.toHaveProperty('mergeIntoIssueId');
  });

  it('mô tả người dùng giữ nguyên (không trim giữa chừng), chỉ bỏ khi rỗng', () => {
    expect(buildReportPayload(form({ description: '  \n ' }))).not.toHaveProperty('description');
    expect(buildReportPayload(form({ description: 'Dòng 1\n\nDòng 2' }))).toMatchObject({
      description: 'Dòng 1\n\nDòng 2',
    });
  });
});

describe('canSubmitReport', () => {
  it('cần dự án + tiêu đề ≥ 3 ký tự sau trim', () => {
    expect(canSubmitReport(form({ summary: 'ab' }))).toBe(false);
    expect(canSubmitReport(form({ summary: '  ab  ' }))).toBe(false);
    expect(canSubmitReport(form({ projectId: '' }))).toBe(false);
    expect(canSubmitReport(form())).toBe(true);
  });
});

describe('nhãn + bản nháp', () => {
  it('tiêu đề hộp theo loại, nhãn loại', () => {
    expect(reportDialogTitle('BUG')).toBe('Báo lỗi');
    expect(reportDialogTitle('FEATURE')).toBe('Gửi yêu cầu');
    expect(reportDialogTitle('QUESTION')).toBe('Gửi yêu cầu');
    expect(reportKindLabel('FEATURE')).toBe('Yêu cầu tính năng');
  });
  it('bản nháp chỉ-mẫu hoặc rỗng thì không đáng lưu', () => {
    expect(hasDraftContent({ kind: 'BUG', description: reportTemplate('BUG') })).toBe(false);
    expect(hasDraftContent({ summary: '  ' })).toBe(false);
    expect(hasDraftContent({ summary: 'Lỗi giỏ hàng' })).toBe(true);
    expect(hasDraftContent({ description: 'Tôi thấy lỗi' })).toBe(true);
  });
});

describe('chế độ Cơ bản / Nâng cao (F3)', () => {
  it('parseReportMode: mặc định Cơ bản; chỉ "advanced" mới là Nâng cao; giá trị lạ/rỗng về Cơ bản', () => {
    expect(parseReportMode(null)).toBe('basic');
    expect(parseReportMode(undefined)).toBe('basic');
    expect(parseReportMode('')).toBe('basic');
    expect(parseReportMode('whatever')).toBe('basic');
    expect(parseReportMode('basic')).toBe('basic');
    expect(parseReportMode('advanced')).toBe('advanced');
  });

  it('descriptionForMode: Nâng cao tự chèn mẫu khi mô tả trống; Cơ bản bỏ mẫu chưa sửa', () => {
    expect(descriptionForMode('', 'BUG', 'advanced')).toBe(reportTemplate('BUG'));
    expect(descriptionForMode('  \n', 'FEATURE', 'advanced')).toBe(reportTemplate('FEATURE'));
    expect(descriptionForMode(reportTemplate('BUG'), 'BUG', 'basic')).toBe('');
    expect(descriptionForMode('', 'BUG', 'basic')).toBe('');
  });

  it('descriptionForMode: chữ người dùng gõ thì chuyển chế độ qua lại KHÔNG mất', () => {
    const typed = 'Bấm Thanh toán không phản hồi';
    const adv = descriptionForMode(typed, 'BUG', 'advanced');
    expect(adv).toBe(typed);
    expect(descriptionForMode(adv, 'BUG', 'basic')).toBe(typed);
    // mẫu đã sửa dở (khác nguyên mẫu) cũng được giữ khi về Cơ bản
    const edited = reportTemplate('BUG') + 'Thêm dòng của tôi';
    expect(descriptionForMode(edited, 'BUG', 'basic')).toBe(edited);
  });

  it('environmentSummary: "Chrome 151 · macOS · 1440×900", bỏ phần trống, trống hết → rỗng', () => {
    expect(environmentSummary({ browser: 'Chrome 151', os: 'macOS', viewport: '1440×900' })).toBe(
      'Chrome 151 · macOS · 1440×900',
    );
    expect(environmentSummary({ browser: 'Safari 17', os: '', viewport: ' ' })).toBe('Safari 17');
    expect(environmentSummary({})).toBe('');
  });

  it('payload Cơ bản: tiêu đề + môi trường tự ghi + mức nghiêm trọng mặc định; không mô tả/mẫu', () => {
    const p = buildReportPayload(
      form({
        summary: 'Nút Thanh toán không bấm được',
        description: descriptionForMode(reportTemplate('BUG'), 'BUG', 'basic'),
        severityId: 'sev-default',
        environment: { browser: 'Chrome 151', os: 'macOS', viewport: '1440×900' },
      }),
    );
    expect(p).toEqual({
      projectId: 'p1',
      kind: 'BUG',
      summary: 'Nút Thanh toán không bấm được',
      severityId: 'sev-default',
      environment: { browser: 'Chrome 151', os: 'macOS', viewport: '1440×900' },
    });
  });
});

describe('severityForSubmit — ⌘Enter ngay khi meta chưa kịp nạp (F3)', () => {
  it('Bug, người dùng chưa chạm tới mức: dùng mức mặc định của dự án dù ô chưa kịp được chọn sẵn', () => {
    expect(
      severityForSubmit({ isBug: true, selected: '', touched: false, defaultId: 'sv-def' }),
    ).toBe('sv-def');
  });
  it('đã chọn thì giữ; đã tự bỏ chọn ("Chưa đánh giá") thì tôn trọng; không phải Bug thì rỗng', () => {
    expect(
      severityForSubmit({ isBug: true, selected: 'sv1', touched: true, defaultId: 'sv-def' }),
    ).toBe('sv1');
    expect(
      severityForSubmit({ isBug: true, selected: '', touched: true, defaultId: 'sv-def' }),
    ).toBe('');
    expect(
      severityForSubmit({ isBug: false, selected: '', touched: false, defaultId: 'sv-def' }),
    ).toBe('');
  });
  it('dự án không có mức nào → rỗng', () => {
    expect(severityForSubmit({ isBug: true, selected: '', touched: false, defaultId: null })).toBe(
      '',
    );
  });
});

describe('descriptionOnKindChange', () => {
  it('trống/mẫu: Nâng cao đổi sang mẫu loại mới, Cơ bản để trống; chữ người dùng giữ nguyên', () => {
    expect(descriptionOnKindChange(reportTemplate('BUG'), 'FEATURE', 'advanced')).toBe(
      reportTemplate('FEATURE'),
    );
    expect(descriptionOnKindChange('', 'QUESTION', 'advanced')).toBe(reportTemplate('QUESTION'));
    expect(descriptionOnKindChange(reportTemplate('BUG'), 'FEATURE', 'basic')).toBe('');
    expect(descriptionOnKindChange('Lỗi của tôi', 'FEATURE', 'basic')).toBe('Lỗi của tôi');
    expect(descriptionOnKindChange('Lỗi của tôi', 'FEATURE', 'advanced')).toBe('Lỗi của tôi');
  });
});
