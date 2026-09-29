export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '');
export const sessionEvents = new EventTarget();
let csrf: Promise<string> | null = null;
export function resetCsrf() { csrf = null; }
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
async function token(): Promise<string> {
  csrf ??= fetch(`${API_BASE}/api/auth/csrf`, { credentials: 'include', cache: 'no-store' })
    .then(async response => { if (!response.ok) throw new Error('Не удалось получить защитный токен. Повторите запрос.'); return (await response.json()).token as string; })
    .catch(error => { csrf = null; throw error; });
  return csrf;
}
export async function authorizedFetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes((init.method ?? 'GET').toUpperCase());
  const headers = new Headers(init.headers);
  if (unsafe) headers.set('X-CSRF-TOKEN', await token());
  const response = await fetch(url, { ...init, headers, credentials: 'include', cache: 'no-store' });
  if (response.status === 401 && !url.endsWith('/api/auth/login') && !url.endsWith('/api/auth/register')) {
    resetCsrf(); sessionEvents.dispatchEvent(new Event('expired'));
  }
  if (unsafe && retry && response.status === 400) {
    const body = await response.clone().json().catch(() => null);
    if (body?.error === 'csrf') { resetCsrf(); return authorizedFetch(url, init, false); }
  }
  return response;
}
export async function onlineRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await authorizedFetch(`${API_BASE}${path}`, { method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const details = Array.isArray(data?.errors) ? data.errors.map((error: { description: string }) => error.description).join(' ')
      : data?.errors && typeof data.errors === 'object' ? Object.values(data.errors).flat().join(' ') : null;
    throw new HttpError(response.status, details || data?.message || data?.error ||
      (response.status === 429 ? 'Слишком много попыток. Подождите минуту.' : response.status === 403 ? 'Недостаточно прав.' : response.status === 401 ? 'Войдите снова.' : `Ошибка сервера (${response.status}).`));
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}
