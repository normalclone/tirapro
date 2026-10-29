import { describe, expect, it } from 'vitest';
import { detectIntent, parseCreateCommand, type Intent } from './intents';

const kind = (s: string): Intent['kind'] => detectIntent(s).kind;

describe('detectIntent — bảng câu mẫu (có dấu / không dấu / viết hoa)', () => {
  const table: [string, Intent['kind']][] = [
    ['Xin chào', 'greeting'],
    ['xin chao', 'greeting'],
    ['HELLO', 'greeting'],
    ['Bạn làm được gì?', 'capabilities'],
    ['ban lam duoc gi', 'capabilities'],
    ['Màn này dùng để làm gì?', 'screen'],
    ['man nay dung de lam gi', 'screen'],
    ['MÀN NÀY DÙNG ĐỂ LÀM GÌ', 'screen'],
    ['Hướng dẫn màn này', 'screen'],
    ['huong dan man nay', 'screen'],
    ['Có gì ở đây?', 'screen'],
    ['co gi o day', 'screen'],
    ['hướng dẫn', 'screen'],
    ['Tóm tắt việc này', 'issue-summary'],
    ['tom tat task nay', 'issue-summary'],
    ['Sprint hiện tại thế nào?', 'sprint-status'],
    ['sprint hien tai the nao', 'sprint-status'],
    ['SPRINT ĐANG CHẠY ra sao', 'sprint-status'],
    ['Việc của tôi', 'my-issues'],
    ['viec cua toi', 'my-issues'],
    ['task của tôi', 'my-issues'],
    ['việc tôi được giao', 'my-issues'],
    ['Việc quá hạn', 'overdue'],
    ['viec qua han', 'overdue'],
    ['CÔNG VIỆC TRỄ HẠN', 'overdue'],
    ['Việc đến hạn tuần này', 'due'],
    ['viec den han tuan nay', 'due'],
    ['việc đến hạn hôm nay', 'due'],
    ['tìm đăng nhập', 'search'],
    ['Tim kiem viec thanh toan', 'search'],
    ['BUG-12', 'issue-key'],
    ['mở demo-task-3 giúp mình', 'issue-key'],
    ['Làm sao tạo sprint?', 'help'],
    ['phân quyền thế nào', 'help'],
    ['nhập excel ở đâu', 'help'],
    ['phím tắt', 'help'],
    ['tạo sprint thế nào', 'help'],
    ['cách tạo task', 'help'],
    ['làm sao tìm kiếm việc', 'help'],
  ];
  for (const [text, want] of table) it(`"${text}" → ${want}`, () => expect(kind(text)).toBe(want));

  it('câu rỗng → empty', () => {
    expect(kind('')).toBe('empty');
    expect(kind('   ')).toBe('empty');
  });
  it('khoảng "tuần này" / "hôm nay" cho ý định hạn', () => {
    expect(detectIntent('việc đến hạn tuần này')).toEqual({ kind: 'due', period: 'week' });
    expect(detectIntent('việc đến hạn hôm nay')).toEqual({ kind: 'due', period: 'today' });
  });
  it('tìm: giữ nguyên văn từ khoá (hoa/dấu), bỏ chữ "việc"', () => {
    expect(detectIntent('Tìm việc Đăng Nhập Lỗi')).toEqual({
      kind: 'search',
      query: 'Đăng Nhập Lỗi',
    });
    expect(detectIntent('tìm: "thanh toán"')).toEqual({ kind: 'search', query: 'thanh toán' });
  });
  it('mã việc được chuẩn hoá HOA', () => {
    expect(detectIntent('bug-12')).toEqual({ kind: 'issue-key', key: 'BUG-12' });
    expect(detectIntent('xem DEMO-BUG-1?')).toEqual({ kind: 'issue-key', key: 'DEMO-BUG-1' });
  });
  it('câu không rõ → help (kho tri thức quyết định có hiểu không)', () => {
    expect(detectIntent('asdf qwer')).toMatchObject({ kind: 'help', explicit: false });
    expect(detectIntent('burndown là gì?')).toMatchObject({ kind: 'help', explicit: true });
  });
});

describe('parseCreateCommand — tách phần lệnh và tiêu đề', () => {
  it('ví dụ của brief: giữ nguyên token trong phần tiêu đề', () => {
    expect(parseCreateCommand('tạo task Sửa lỗi login !cao @an ^mai #sprint ~3')).toEqual({
      typeHint: null,
      text: 'Sửa lỗi login !cao @an ^mai #sprint ~3',
    });
  });
  it('không dấu / hoa thường / từ đệm', () => {
    expect(parseCreateCommand('TAO VIEC Gửi báo giá')?.text).toBe('Gửi báo giá');
    expect(parseCreateCommand('tao cong viec moi: Dọn kho')?.text).toBe('Dọn kho');
    expect(parseCreateCommand('Hãy tạo giúp tôi một task - Viết tài liệu')?.text).toBe(
      'Viết tài liệu',
    );
    expect(parseCreateCommand('tôi muốn thêm 1 task Test')?.text).toBe('Test');
    expect(parseCreateCommand('create issue Fix typo')?.text).toBe('Fix typo');
  });
  it('gợi ý loại: bug / story / epic', () => {
    expect(parseCreateCommand('thêm bug Nút lưu không bấm được')).toEqual({
      typeHint: 'bug',
      text: 'Nút lưu không bấm được',
    });
    expect(parseCreateCommand('báo lỗi trang chủ trắng')).toEqual({
      typeHint: 'bug',
      text: 'trang chủ trắng',
    });
    expect(parseCreateCommand('tạo user story Đăng ký bằng email')?.typeHint).toBe('story');
    expect(parseCreateCommand('tạo Epic Thanh toán')).toEqual({
      typeHint: 'epic',
      text: 'Thanh toán',
    });
  });
  it('chỉ có lệnh → tiêu đề rỗng (trợ lý sẽ hỏi lại)', () => {
    expect(parseCreateCommand('tạo task')).toEqual({ typeHint: null, text: '' });
    expect(parseCreateCommand('thêm bug:')).toEqual({ typeHint: 'bug', text: '' });
  });
  it('KHÔNG phải lệnh tạo việc: sprint / dự án / câu hỏi cách làm', () => {
    expect(parseCreateCommand('tạo sprint mới')).toBeNull();
    expect(parseCreateCommand('tạo dự án Alpha')).toBeNull();
    expect(parseCreateCommand('thêm người vào dự án')).toBeNull();
    expect(parseCreateCommand('task của tôi')).toBeNull();
    expect(kind('làm sao tạo task')).toBe('help');
    expect(kind('cách tạo bug')).toBe('help');
  });
  it('intent create mang typeHint + text', () => {
    expect(detectIntent('Thêm BUG Lỗi 500 khi lưu ^mai')).toEqual({
      kind: 'create',
      typeHint: 'bug',
      text: 'Lỗi 500 khi lưu ^mai',
    });
  });
  it('mã việc sau lệnh tạo vẫn là tiêu đề, không bị hiểu thành tra mã', () => {
    expect(kind('tạo task BUG-12 chưa sửa xong')).toBe('create');
  });
});

describe('câu hỏi cách làm không bị hiểu thành lệnh tạo', () => {
  it('báo lỗi thế nào / tạo task ở đâu → help', () => {
    expect(kind('báo lỗi thế nào')).toBe('help');
    expect(kind('Báo lỗi thế nào?')).toBe('help');
    expect(kind('tạo task ở đâu')).toBe('help');
  });
});

describe('chi tiết khác', () => {
  it('việc sắp đến hạn (không nói khoảng) → tuần này', () => {
    expect(detectIntent('việc sắp đến hạn')).toEqual({ kind: 'due', period: 'week' });
  });
  it('"tìm hiểu …" không phải lệnh tìm việc', () => {
    expect(kind('tìm hiểu về sprint')).toBe('help');
  });
});

describe('vòng review 1', () => {
  it('"lỗi tôi gặp…" không phải "việc của tôi"', () => {
    expect(kind('lỗi tôi gặp khi đăng nhập')).not.toBe('my-issues');
    expect(kind('tìm lỗi tôi gặp')).toBe('search');
    expect(kind('việc của tôi đang làm')).toBe('my-issues');
    expect(kind('task của tôi')).toBe('my-issues');
  });
  it('câu ngắn có mã việc → tóm tắt theo mã dù có "quá hạn"', () => {
    expect(detectIntent('BUG-12 quá hạn chưa')).toEqual({ kind: 'issue-key', key: 'BUG-12' });
    expect(kind('việc quá hạn')).toBe('overdue');
  });
  it('"… được không" là hỏi cách làm, không dựng nháp', () => {
    expect(kind('tạo task bằng email được không')).toBe('help');
  });
});
