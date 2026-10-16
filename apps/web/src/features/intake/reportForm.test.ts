import { describe, expect, it } from 'vitest';
import {
  buildReportPayload,
  canSubmitReport,
  hasDraftContent,
  isReportTemplate,
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
