import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Block } from './blocks';
import type { Message } from './conversation';
import { buildDraft } from './draft';
import { AssistantPanelView, staticDraft } from './AssistantPanel';
import { META, PROJ, SPRINTS, USERS } from './fixtures';

const noop = () => undefined;
const draft = (text: string) =>
  buildDraft({ text, typeHint: null, project: PROJ, meta: META, users: USERS, sprints: SPRINTS })!;

function html(messages: Message[], extra: { busy?: boolean; input?: string } = {}) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AssistantPanelView
        messages={messages}
        busy={extra.busy ?? false}
        input={extra.input ?? ''}
        onInput={noop}
        onSend={noop}
        onClear={noop}
        onMinimize={noop}
        onClose={noop}
        onChip={noop}
        onTour={noop}
        onNavigate={noop}
        renderDraft={staticDraft}
      />
    </MemoryRouter>,
  );
}
const bot = (blocks: Block[]): Message => ({ id: 'b', role: 'bot', blocks });

describe('AssistantPanelView (render tĩnh)', () => {
  it('danh sách tin là vùng live polite; ô nhập có tên truy cập; nút gửi và xoá có nhãn', () => {
    const h = html([bot([{ type: 'text', text: 'Xin chào' }])]);
    expect(h).toContain('role="log"');
    expect(h).toContain('aria-live="polite"');
    expect(h).toContain('aria-label="Nhập câu hỏi cho trợ lý"');
    expect(h).toContain('aria-label="Gửi"');
    for (const l of ['Xoá hội thoại', 'Thu nhỏ', 'Đóng']) expect(h).toContain(`aria-label="${l}"`);
    expect(h).toContain('Trợ lý Tirapro');
    expect(h).toContain('Enter gửi · Shift+Enter xuống dòng');
  });
  it('chip gợi ý là <button type="button"> bấm được bằng bàn phím', () => {
    const h = html([
      bot([{ type: 'chips', chips: [{ label: 'Việc quá hạn', text: 'việc quá hạn' }] }]),
    ]);
    expect(h).toMatch(/<button type="button"[^>]*>Việc quá hạn<\/button>/);
  });
  it('chữ của người dùng và tiêu đề việc được thoát HTML (không chèn được thẻ)', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const h = html([
      { id: 'u', role: 'user', blocks: [{ type: 'text', text: evil }] },
      bot([
        {
          type: 'issues',
          rows: [
            { key: 'DEMO-1', summary: evil, status: 'To Do', due: '01/01/2026', overdue: true },
          ],
          more: false,
          seeAllTo: '/filters?jql=x',
        },
        { type: 'facts', title: evil, rows: [{ label: 'a', value: evil }] },
        { type: 'text', text: evil },
      ]),
    ]);
    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
  it('dòng việc là liên kết router tới /issue/KEY; quá hạn được ghi rõ; có "Xem tất cả"', () => {
    const h = html([
      bot([
        {
          type: 'issues',
          rows: [
            { key: 'DEMO-1', summary: 'A', status: 'To Do', due: '01/01/2026', overdue: true },
          ],
          more: true,
          seeAllTo: '/filters?jql=due%20%3C',
        },
      ]),
    ]);
    expect(h).toContain('href="/issue/DEMO-1"');
    expect(h).toContain('Hạn 01/01/2026 · quá hạn');
    expect(h).toContain('href="/filters?jql=due%20%3C"');
    expect(h).toContain('Xem tất cả');
  });
  it('link hướng dẫn mở tab mới an toàn (trang Docs nằm ngoài khung ứng dụng)', () => {
    const h = html([
      bot([
        {
          type: 'links',
          items: [
            {
              title: 'Phím tắt',
              summary: 'tóm tắt',
              to: '/documentation#phim-tat',
              linkLabel: 'Xem hướng dẫn',
            },
          ],
        },
      ]),
    ]);
    expect(h).toContain('href="/documentation#phim-tat"');
    expect(h).toContain('target="_blank"');
    expect(h).toContain('rel="noopener noreferrer"');
    expect(h).toContain('Xem hướng dẫn');
  });
  it('nút chạy hướng dẫn từng bước là button', () => {
    const h = html([bot([{ type: 'tour', label: 'Chạy hướng dẫn từng bước' }])]);
    expect(h).toMatch(/<button[^>]*>Chạy hướng dẫn từng bước<\/button>/);
  });
  it('đang tìm → có dòng trạng thái; ô nhập trống thì nút Gửi bị vô hiệu', () => {
    const h = html([], { busy: true, input: '' });
    expect(h).toContain('Trợ lý đang tìm…');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Gửi"/);
    expect(html([], { input: 'xin chào' })).not.toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Gửi"/,
    );
  });
});

describe('thẻ nháp (render tĩnh)', () => {
  const cardOf = (
    status: Extract<Block, { type: 'draft' }>['status'],
    extra: Partial<Extract<Block, { type: 'draft' }>> = {},
  ) =>
    html([
      bot([
        {
          type: 'draft',
          draft: draft('Sửa lỗi login !high @an ^mai ~3 @khongco'),
          status,
          ...extra,
        },
      ]),
    ]);

  it('hiện đủ: dự án, loại, tiêu đề, ưu tiên, người, sprint, điểm, hạn + cảnh báo token không khớp', () => {
    const h = cardOf('pending');
    for (const t of [
      'Demo (DEMO)',
      'Task',
      'Sửa lỗi login',
      'High',
      'An Nguyễn',
      'Việc chờ (chưa vào sprint)',
      '>3<',
    ])
      expect(h).toContain(t);
    expect(h).toContain('Không nhận ra');
    expect(h).toContain('@khongco');
  });
  it('đang chờ: có Tạo / Mở form đầy đủ / Bỏ', () => {
    const h = cardOf('pending');
    expect(h).toMatch(/<button[^>]*>Tạo<\/button>/);
    expect(h).toContain('Mở form đầy đủ');
    expect(h).toContain('>Bỏ<');
  });
  it('đã tạo: link tới việc, không còn nút Tạo', () => {
    const h = cardOf('created', { createdKey: 'DEMO-TASK-9' });
    expect(h).toContain('href="/issue/DEMO-TASK-9"');
    expect(h).not.toMatch(/<button[^>]*>Tạo<\/button>/);
  });
  it('lỗi: báo lỗi (role=alert) và cho "Tạo lại"', () => {
    const h = cardOf('failed', { error: 'Mất mạng' });
    expect(h).toContain('role="alert"');
    expect(h).toContain('Mất mạng');
    expect(h).toContain('Tạo lại');
  });
  it('đã bỏ / đã mở form đầy đủ: chỉ còn dòng trạng thái', () => {
    expect(cardOf('cancelled')).toContain('Đã bỏ nháp này');
    expect(cardOf('opened')).toContain('Đã mở trong form đầy đủ');
    expect(cardOf('opened')).not.toContain('Mở form đầy đủ</button>');
  });
});
