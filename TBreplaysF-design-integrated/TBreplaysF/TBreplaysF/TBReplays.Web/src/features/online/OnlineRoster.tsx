import { useEffect, useRef, useState } from 'react';
import { onlineRequest } from '../../api/OnlineHttp';
import type { OnlineUser } from './OnlineModels';
import { useOnline } from './OnlineRoot';

export function OnlineRoster() {
  const { user, state } = useOnline();
  const [accounts, setAccounts] = useState<OnlineUser[]>([]);
  const [error, setError] = useState('');
  const admin = user.role === 'admin';
  useEffect(() => {
    if (!admin) return;
    let active = true;
    const load = () => void onlineRequest<OnlineUser[]>('/api/users').then(users => {
      if (active) setAccounts(users);
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Не удалось получить пользователей.'); });
    load();
    const timer = setInterval(load, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [admin]);
  useEffect(() => {
    if (!admin) return;
    setAccounts(current => current.map(account => {
      const live = state.users.find(item => item.id === account.id);
      return live && live.role !== account.role ? { ...account, role: live.role } : account;
    }));
  }, [admin, state.users]);
  const users = state.users.map(live => ({ ...accounts.find(account => account.id === live.id), ...live }));
  return <div className="online-roster">
    <div className="users-header"><span className="panel-label static">Пользователи</span><span className="users-count">({state.users.length} онлайн)</span></div>
    <ul className="compact-roster">{users.map(item => <li key={item.id} className={item.id === user.id ? 'current' : ''}>
      <div className="user-name-with-status"><i className={state.users.some(x => x.id === item.id) ? 'online-user-dot connected' : 'online-user-dot'} title={state.users.some(x => x.id === item.id) ? 'В сети' : 'Не в сети'} /><strong title={item.login}>{item.login}</strong>{state.users.find(x => x.id === item.id)?.isPresenting && <small className="presenter-badge">Презентует</small>}</div>
      <RoleChip item={item} liveRole={state.users.find(x => x.id === item.id)?.role} editable={admin && item.role !== 'admin'}
        onChanged={updated => { setAccounts(current => current.map(x => x.id === updated.id ? updated : x)); setError(''); }}
        onError={setError} />
    </li>)}</ul>
    {error && <p role="alert">{error}</p>}
  </div>;
}

function RoleChip({ item, liveRole, editable, onChanged, onError }: {
  item: OnlineUser;
  liveRole?: OnlineUser['role'];
  editable: boolean;
  onChanged: (user: OnlineUser) => void;
  onError: (message: string) => void;
}) {
  const [displayRole, setDisplayRole] = useState(item.role);
  const [previous, setPrevious] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const pending = useRef<{ token: symbol; oldRole: OnlineUser['role']; nextRole: OnlineUser['role'] } | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const animation = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const name = (role: string) => role === 'admin' ? 'админ' : role === 'editor' ? 'редактор' : 'наблюдатель';

  const animate = (from: string) => {
    setPrevious(from);
    clearTimeout(animation.current);
    animation.current = setTimeout(() => setPrevious(null), 320);
  };
  const confirm = (updated: OnlineUser, token: symbol) => {
    if (pending.current?.token !== token) return;
    clearTimeout(timeout.current);
    pending.current = null;
    setWaiting(false);
    setDisplayRole(updated.role);
    onChanged(updated);
    onError('');
  };
  const rollback = (message: string, token: symbol) => {
    const current = pending.current;
    if (!current || current.token !== token) return;
    clearTimeout(timeout.current);
    pending.current = null;
    setWaiting(false);
    animate(current.nextRole);
    setDisplayRole(current.oldRole);
    onChanged({ ...item, role: current.oldRole });
    onError(message);
  };

  useEffect(() => {
    if (!waiting) setDisplayRole(item.role);
  }, [item.role, waiting]);
  useEffect(() => {
    const current = pending.current;
    if (current && liveRole === current.nextRole) confirm({ ...item, role: current.nextRole }, current.token);
  }, [liveRole]);
  useEffect(() => () => { clearTimeout(timeout.current); clearTimeout(animation.current); }, []);

  const change = () => {
    if (!editable || waiting) return;
    const oldRole = displayRole;
    const nextRole: OnlineUser['role'] = oldRole === 'editor' ? 'observer' : 'editor';
    const token = Symbol('role-change');
    pending.current = { token, oldRole, nextRole };
    setWaiting(true);
    animate(oldRole);
    setDisplayRole(nextRole);
    onError('');
    timeout.current = setTimeout(() => rollback('Сервер не подтвердил смену роли за 2 секунды.', token), 2000);
    void onlineRequest<OnlineUser>(`/api/users/${item.id}/role`, 'PUT', { role: nextRole })
      .then(updated => confirm(updated, token))
      .catch(error => rollback(error instanceof Error ? error.message : 'Не удалось изменить роль.', token));
  };

  return <button className={`role-chip${displayRole === 'admin' ? ' admin-chip' : ''}${previous ? ' is-switching' : ''}`}
    type="button" disabled={!editable || waiting} aria-label={`Роль ${item.login}: ${name(displayRole)}`}
    title={editable ? 'Переключить: наблюдатель / редактор' : name(displayRole)} onClick={change}>
    {previous && <span className="role-slide-layer role-slide-out" aria-hidden="true">{name(previous)}</span>}
    <span className={previous ? 'role-label role-slide-in' : 'role-label'}>{name(displayRole)}</span>
  </button>;
}
