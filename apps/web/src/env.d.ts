/// <reference types="vite/client" />

// Khai báo kiểu cho biến môi trường Vite đang dùng (mặc định `import.meta.env.X` là `any`).
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WS_URL?: string;
}
