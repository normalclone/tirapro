import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPIED_FLASH_MS, dashboardUrl, filterUrl, issueUrl, writeClipboard } from './copyText';

describe('issueUrl', () => {
  it('ghép origin + /issue/KEY, không mang query/hash của trang hiện tại', () => {
    expect(issueUrl('TIRA-12', 'https://app.example.com')).toBe(
      'https://app.example.com/issue/TIRA-12',
    );
  });
  it('bỏ dấu / thừa ở cuối origin', () => {
    expect(issueUrl('A-1', 'https://x.test/')).toBe('https://x.test/issue/A-1');
  });
  it('mã được mã hoá đường dẫn', () => {
    expect(issueUrl('A B/1', 'https://x.test')).toBe('https://x.test/issue/A%20B%2F1');
  });
  it('mặc định lấy origin của cửa sổ hiện tại', () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } });
    expect(issueUrl('P-3')).toBe('http://localhost:5173/issue/P-3');
    vi.unstubAllGlobals();
  });
});

describe('dashboardUrl / filterUrl — liên kết TRONG ứng dụng (không cấp thêm quyền)', () => {
  it('bảng tổng quan: origin + /dashboards/ID', () => {
    expect(dashboardUrl('d1', 'https://app.example.com/')).toBe(
      'https://app.example.com/dashboards/d1',
    );
  });
  it('bộ lọc: origin + /filters/ID', () => {
    expect(filterUrl('f1', 'https://app.example.com')).toBe('https://app.example.com/filters/f1');
  });
  it('id được mã hoá đường dẫn', () => {
    expect(filterUrl('a/b c', 'https://x.test')).toBe('https://x.test/filters/a%2Fb%20c');
  });
});

describe('COPIED_FLASH_MS', () => {
  it('dấu ✓ hiện 1,2 giây', () => {
    expect(COPIED_FLASH_MS).toBe(1200);
  });
});

describe('writeClipboard', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('true khi ghi được', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(writeClipboard('abc')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('abc');
  });
  // Môi trường test là node (không có DOM) nên dựng `document` tối thiểu để thử nhánh execCommand.
  function stubDocument(execResult: boolean) {
    const exec = vi.fn().mockReturnValue(execResult);
    const el = {
      value: '',
      style: {} as Record<string, string>,
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      remove: vi.fn(),
    };
    const bodyAppend = vi.fn();
    vi.stubGlobal('document', {
      activeElement: null,
      createElement: vi.fn(() => el),
      body: { appendChild: bodyAppend },
      execCommand: exec,
    });
    return { exec, el, bodyAppend };
  }
  it('HTTP thường (không có navigator.clipboard): lùi về execCommand, true khi chép được', async () => {
    vi.stubGlobal('navigator', {});
    const { exec } = stubDocument(true);
    await expect(writeClipboard('abc')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });
  it('Clipboard API từ chối: vẫn lùi về execCommand', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('x')) },
    });
    const { exec } = stubDocument(true);
    await expect(writeClipboard('abc')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });
  it('false khi cả Clipboard API lẫn execCommand đều không được', async () => {
    vi.stubGlobal('navigator', {});
    stubDocument(false);
    await expect(writeClipboard('abc')).resolves.toBe(false);
  });
  // TIRA-BUG-26: trước đây không focus textarea → trong hộp thoại có bẫy focus, execCommand trả true
  // nhưng clipboard rỗng. Nay phải focus() + select() trước khi chép, và dọn textarea sau đó.
  it('nhánh execCommand: focus() + select() TRƯỚC khi chép, rồi gỡ textarea', async () => {
    vi.stubGlobal('navigator', {});
    const { exec, el } = stubDocument(true);
    await writeClipboard('https://x.test/filters/f1');
    expect(el.focus).toHaveBeenCalled();
    expect(el.select).toHaveBeenCalled();
    expect(el.setSelectionRange).toHaveBeenCalledWith(0, 'https://x.test/filters/f1'.length);
    expect(el.focus.mock.invocationCallOrder[0]!).toBeLessThan(exec.mock.invocationCallOrder[0]!);
    expect(el.select.mock.invocationCallOrder[0]!).toBeLessThan(exec.mock.invocationCallOrder[0]!);
    expect(el.remove).toHaveBeenCalled();
  });
  it('nhánh execCommand: gắn textarea vào cùng vùng với phần tử đang focus (trong bẫy focus)', async () => {
    vi.stubGlobal('navigator', {});
    const { exec, el } = stubDocument(true);
    const scopeAppend = vi.fn();
    const restore = vi.fn();
    const active = { parentElement: { appendChild: scopeAppend }, focus: restore };
    (document as unknown as { activeElement: unknown }).activeElement = active;
    await expect(writeClipboard('abc')).resolves.toBe(true);
    expect(scopeAppend).toHaveBeenCalledWith(el); // không gắn vào document.body
    expect(exec).toHaveBeenCalledWith('copy');
    expect(restore).toHaveBeenCalled(); // trả focus về chỗ cũ
  });
});
