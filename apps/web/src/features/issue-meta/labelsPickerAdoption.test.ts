import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('SearchSelect — mở rộng cho ô nhãn (không viết popup mới)', () => {
  const src = read('components/ui/SearchSelect.tsx');
  it('có dòng ghim không bị lọc, móc phím ô tìm, báo mở/đóng', () => {
    expect(src).toMatch(/pinnedOptions\?:/);
    expect(src).toMatch(/onSearchKeyDown\?:/);
    expect(src).toMatch(/onOpenChange\?:/);
  });
  it('Enter trong ô tìm đi qua shouldSubmitOnEnter (không chốt chữ Telex/VNI thành thao tác)', () => {
    expect(src).toMatch(/shouldSubmitOnEnter\(/);
    expect(src).toMatch(/useJustComposed\(/);
    expect(src).toMatch(/onCompositionEnd/);
  });
});

describe('IssueLabelsPicker — ô nhãn có màu', () => {
  const src = read('features/issue-meta/IssueLabelsPicker.tsx');
  it('dựng trên SearchSelect, chip tô bằng labelToneStyle, không dùng màu thô của nhãn', () => {
    expect(src).toContain("from '@/components/ui/SearchSelect'");
    expect(src).toContain('<SearchSelect');
    expect(src).toContain('labelToneStyle');
    expect(src).not.toMatch(/label\.color \?\?|background: label\.color/);
    expect(src).not.toContain('@radix-ui/react-popover');
  });
  it('quyền tạo nhãn = project:admin theo dự án (đúng như trang Nhãn), có tính dự án lưu trữ', () => {
    expect(src).toMatch(/useCanIn\(issue\.projectId\)/);
    expect(src).toMatch(/PERMISSIONS\.PROJECT_ADMIN|'project:admin'/);
  });
  it('nút gỡ chip tên "Gỡ nhãn {tên}", 44px khi cảm ứng', () => {
    expect(src).toMatch(/aria-label=\{`Gỡ nhãn \$\{label\.name\}`\}/);
    expect(src).toContain('[@media(pointer:coarse)]:h-11');
    expect(src).toContain('[@media(pointer:coarse)]:w-11');
  });
  it('Backspace chờ gỡ qua reducePending, có vùng báo cho trình đọc màn hình', () => {
    expect(src).toContain('reducePending');
    expect(src).toMatch(/role="status"/);
    expect(src).toContain('pendingAnnouncement');
  });
});

describe('tạo nhãn khi gắn — nối dây', () => {
  const api = read('features/issue-meta/api.ts');
  const picker = read('features/issue-meta/IssueLabelsPicker.tsx');
  it('hook dùng hàm thuần createAndAttachLabel và báo lỗi ở onError của hook (không mất khi huỷ/unmount)', () => {
    expect(api).toContain("from './createAndAttach'");
    expect(api).toContain('createAndAttachLabel(');
    expect(api).toContain('labelCreateErrorMessage');
    expect(api).toContain("from 'sonner'");
  });
  it('hook tự báo lỗi nên đặt meta.silent (toast chung của MutationCache không báo thêm câu chung chung)', () => {
    const i = api.indexOf('export function useCreateAndAttachLabel');
    expect(api.slice(i, i + 1500)).toMatch(/meta:\s*\{\s*silent:\s*true\s*\}/);
  });
  it('nơi gọi KHÔNG tự bắt lỗi theo từng lần mutate (toast nằm ở hook)', () => {
    expect(picker).not.toMatch(/createAttach\.mutate\([^)]*onError/s);
    expect(picker).not.toContain('Chưa tạo được nhãn');
  });
  it('vá lạc quan dùng patchIssueLabels và không đụng version', () => {
    expect(api).toContain('patchIssueLabels');
  });
  it('Backspace: bỏ qua phím lặp và khi đang gỡ; có gợi ý nhìn thấy trong popup; vòng báo chờ gỡ khác màu nhãn', () => {
    expect(picker).toMatch(/repeat: e\.repeat/);
    expect(picker).toMatch(/busy: detach\.isPending/);
    expect(picker).toContain('searchHint');
    expect(picker).toMatch(/ring-ink-strong/);
    expect(read('components/ui/SearchSelect.tsx')).toMatch(/searchHint\?:/);
  });
});

describe('m1 — mọi nơi hiển thị nhãn dùng cùng tông (labelTone)', () => {
  it.each([['features/bulk/BulkDock.tsx'], ['features/automation/RuleEditor.tsx']])('%s', (rel) => {
    const src = read(rel);
    expect(src).toContain('labelTone');
    expect(src).not.toMatch(/label: l\.name, color: l\.color/);
  });
});
