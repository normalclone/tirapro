import { describe, expect, it } from 'vitest';
import { render } from './digest';

const payload = {
  title: 'Tổng kết',
  subtitle: 'Tuần 42',
  sections: [{ id: 's', title: 'Sprint', lines: ['A & B'] }],
  createdBy: 'Lan <PM>',
  url: 'http://localhost:5173',
};

describe('mail template digest', () => {
  it('subject = tiêu đề; html escape đúng một lần (A &amp; B); text giữ "A & B"', () => {
    const r = render(payload);
    expect(r.subject).toBe('Tổng kết');
    expect(r.html).toContain('A &amp; B');
    expect(r.html).not.toContain('A &amp;amp; B');
    expect(r.text).toContain('A & B');
    expect(r.text).not.toContain('&amp;');
  });

  it('có phụ đề, tiêu đề khối, người tạo trong chân thư (escape), nói rõ nhận cả khi tắt email thông báo', () => {
    const r = render(payload);
    expect(r.html).toContain('Tuần 42');
    expect(r.html).toContain('Sprint');
    expect(r.html).toContain('Lan &lt;PM&gt;');
    expect(r.html).not.toContain('<PM>');
    expect(r.html).toContain('kể cả khi');
    expect(r.text).toContain('Lan <PM>');
  });

  it('liên kết chỉ http(s); payload hỏng không làm render ném lỗi', () => {
    expect(render({ ...payload, url: 'javascript:alert(1)' }).html).not.toContain('javascript:');
    const r = render({ sections: 'oops' });
    expect(r.subject).toBe('Báo cáo định kỳ');
    expect(r.html).toContain('<html');
  });

  it('bỏ qua khối không có dòng', () => {
    const r = render({ ...payload, sections: [{ id: 'x', title: 'Rỗng', lines: [] }] });
    expect(r.html).not.toContain('Rỗng');
  });
});
