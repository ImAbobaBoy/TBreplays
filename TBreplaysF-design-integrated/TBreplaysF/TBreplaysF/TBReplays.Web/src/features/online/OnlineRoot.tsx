import { OnlineRoster } from './OnlineRoster';
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode, FormEvent } from 'react';
import { HttpError, onlineRequest, resetCsrf, sessionEvents } from '../../api/OnlineHttp';
import { OnlineClient } from './OnlineClient';
import { roleNames } from './OnlineModels';
import type { OnlineState, OnlineUser } from './OnlineModels';
import './online.css';

type OnlineContextValue = { user: OnlineUser; client: OnlineClient; state: OnlineState; canEdit: boolean; signOut: () => void };
const OnlineContext = createContext<OnlineContextValue | null>(null);
export function useOnline() { const value = useContext(OnlineContext); if (!value) throw new Error('Online session missing'); return value; }

export function OnlineRoot({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<OnlineUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    const expired = () => { setUser(null); setMessage('Сессия завершена или права изменены. Войдите снова.'); };
    sessionEvents.addEventListener('expired', expired);
    void onlineRequest<OnlineUser>('/api/auth/me').then(value => { if (active) setUser(value); })
      .catch(error => { if (active && !(error instanceof HttpError && error.status === 401)) setMessage('Сервер недоступен. Проверьте запуск backend и повторите вход.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; sessionEvents.removeEventListener('expired', expired); };
  }, []);
  if (loading) return <div className="online-login"><p>Проверяю вход…</p></div>;
  if (!user) return <Login message={message} onLogin={setUser} />;
  return <OnlineSession key={user.id} user={user} signOut={() => { resetCsrf(); setUser(null); setMessage('Войдите в аккаунт.'); }}>{children}</OnlineSession>;
}
function OnlineSession({ user, signOut, children }: { user: OnlineUser; signOut: () => void; children: ReactNode }) {
  const [client, setClient] = useState<OnlineClient | null>(null);
  useEffect(() => { const current = new OnlineClient(); setClient(current); void current.start(); return () => current.dispose(); }, []);
  return client ? <SessionView user={user} signOut={signOut} client={client}>{children}</SessionView> : <div className="online-login">Подключаюсь…</div>;
}
function SessionView({ user, signOut, client, children }: { user: OnlineUser; signOut: () => void; client: OnlineClient; children: ReactNode }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const currentUser = state.users.find(item => item.id === user.id) ?? user;
  return <OnlineContext.Provider value={{ user: currentUser, signOut, client, state, canEdit: currentUser.role !== 'observer' && state.status === 'connected' }}>
    {children}
  </OnlineContext.Provider>;
}
function Login({ message, onLogin }: { message: string; onLogin: (user: OnlineUser) => void }) {
  const [register, setRegister] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      resetCsrf();
      if (register) {
        await onlineRequest('/api/auth/register', 'POST', { login, password });
        setRegister(false); setPassword(''); setError('Аккаунт создан. Войдите с вашим паролем.'); return;
      }
      const user = await onlineRequest<OnlineUser>('/api/auth/login', 'POST', { login, password });
      resetCsrf(); setPassword(''); onLogin(user);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось войти.'); }
    finally { setBusy(false); }
  };
  return <div className="online-login"><form onSubmit={event => void submit(event)}>
    <h1>TBReplays</h1><h2>{register ? 'Регистрация' : 'Вход в общий скетч'}</h2>
    <label>Логин<input name="username" autoComplete="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_-]+" value={login} onChange={e => setLogin(e.target.value)} /></label>
    <label>Пароль<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 8 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></label>
    {register && <p>Новый аккаунт получает роль наблюдателя. Доступ к рисованию выдаёт администратор.</p>}
    <p role="status">{error || message}</p>
    <button disabled={busy}>{busy ? 'Подождите…' : register ? 'Создать аккаунт' : 'Войти'}</button>
    <button type="button" disabled={busy} onClick={() => { setRegister(!register); setPassword(''); setError(''); }}>{register ? 'Уже есть аккаунт' : 'Зарегистрироваться'}</button>
    <small>Забыли пароль? Обратитесь к администратору.</small>
  </form></div>;
}

export function OnlinePanel() {
  const { user, state, client, signOut } = useOnline();
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const logout = async () => {
    setBusy(true); setError('');
    try { await onlineRequest('/api/auth/logout', 'POST'); signOut(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось выйти. Повторите попытку.'); }
    finally { setBusy(false); }
  };
  return <section className="panel online-panel">
    <strong>{user.login} · {roleNames[user.role]}</strong>
    <p role="status">{state.status === 'connected' ? 'Общая доска подключена' : 'Нет синхронизации'}</p>
    {state.message && <p role="status">{state.message}</p>}
    {error && <p role="alert">{error}</p>}
    {state.status === 'offline' && <button onClick={() => void client.start()}>Подключиться</button>}
    <button onClick={() => setSettings(true)}>{user.role === 'admin' ? 'Аккаунт и пользователи' : 'Сменить пароль'}</button>
    <button disabled={busy} onClick={() => void logout()}>Выйти</button>
    <p>Линий: {state.board?.strokes.length ?? 0}</p>
    <p>Сейчас в скетче: {state.users.length}</p>
    <p>Танков: {state.board?.tanks?.length ?? 0}</p>
    <OnlineRoster />
    {settings && <AccountDialog onClose={() => setSettings(false)} />}
  </section>;
}
function AccountDialog({ onClose }: { onClose: () => void }) {
  const { user, signOut, state } = useOnline();
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [target, setTarget] = useState<OnlineUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => { try { setUsers(await onlineRequest<OnlineUser[]>('/api/users')); } catch (e) { setMessage(e instanceof Error ? e.message : 'Не удалось получить пользователей.'); } };
  useEffect(() => { if (user.role === 'admin') void load(); }, [user.role]);
  useEffect(() => {
    if (user.role !== 'admin') return;
    setUsers(current => current.map(account => {
      const live = state.users.find(item => item.id === account.id);
      return live && live.role !== account.role ? { ...account, role: live.role } : account;
    }));
  }, [state.users, user.role]);
  const changeRole = (item: OnlineUser, role: OnlineUser['role']) => {
    if (role === item.role) return;
    setMessage('');
    setUsers(current => current.map(userItem => userItem.id === item.id ? { ...userItem, role } : userItem));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const confirmation = Promise.race([
      onlineRequest<OnlineUser>(`/api/users/${item.id}/role`, 'PUT', { role }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Сервер не подтвердил смену роли за 2 секунды.')), 2000); }),
    ]);
    void confirmation.then(updated => {
      setUsers(current => current.map(userItem => userItem.id === updated.id ? updated : userItem));
    }).catch(error => {
      setUsers(current => current.map(userItem => userItem.id === item.id ? item : userItem));
      setMessage(error instanceof Error ? error.message : 'Не удалось изменить роль.');
    }).finally(() => { if (timeout) clearTimeout(timeout); });
  };
  const action = async (work: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await work(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Не удалось выполнить действие.'); } finally { setBusy(false); }
  };
  return <div className="online-modal" onPointerDown={e => e.stopPropagation()}><div role="dialog" aria-modal="true" aria-label="Аккаунт и пользователи">
    <button className="online-close" onClick={onClose}>Закрыть</button><h2>Аккаунт</h2>
    <form onSubmit={e => { e.preventDefault(); void action(async () => { await onlineRequest('/api/auth/change-password', 'POST', { currentPassword, newPassword }); signOut(); }); }}>
      <label>Текущий пароль<input type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label>
      <label>Новый пароль<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>
      <button disabled={busy}>Сменить пароль</button>
    </form>
    <p role="status">{message}</p>
    {user.role === 'admin' && <><h2>Пользователи</h2><button disabled={busy} onClick={() => void load()}>Обновить список</button>
      <table><thead><tr><th>Логин</th><th>Роль</th><th>Пароль</th></tr></thead><tbody>{users.map(item => <tr key={item.id}>
        <td>{item.login}</td><td>{item.role === 'admin' ? <span>Администратор</span> : <select aria-label={`Роль ${item.login}`} value={item.role} disabled={busy} onChange={e => changeRole(item, e.target.value as OnlineUser['role'])}>
          <option value="observer">Наблюдатель</option><option value="editor">Редактор</option>
        </select>}</td><td><button disabled={busy} onClick={() => { setTarget(item); setResetPassword(''); }}>Сбросить пароль</button></td>
      </tr>)}</tbody></table>
      {target && <form onSubmit={e => { e.preventDefault(); void action(async () => { await onlineRequest(`/api/users/${target.id}/reset-password`, 'POST', { password: resetPassword }); setResetPassword(''); setMessage(`Пароль ${target.login} изменён. Старые сеансы завершены.`); if (target.id === user.id) signOut(); setTarget(null); }); }}>
        <label>Новый пароль для {target.login}<input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} /></label><button disabled={busy}>Установить пароль</button>
      </form>}</>}
  </div></div>;
}
