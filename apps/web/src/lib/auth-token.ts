// Access token giữ in-memory (chống XSS — không localStorage). Refresh qua httpOnly cookie.
let accessToken: string | null = null;

export const getAccessToken = (): string | null => accessToken;
export const setAccessToken = (t: string | null): void => {
  accessToken = t;
};
