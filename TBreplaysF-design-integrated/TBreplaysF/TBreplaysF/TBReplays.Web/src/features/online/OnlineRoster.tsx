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
    load(); const timer = setInterval(load, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [admin, state.users]);
  const users = admin ? accounts : state.users;
  return <div className="online-roster">
    <div className="users-header"><span className="panel-label static">Пользователи</span><span className="users-count">{users.length}</span></div>
    <ul className="compact-roster">{users.map(item => <li key={item.id} className={item.id === user.id ? 'current' : ''}>
      <div className="user-name-with-status"><i className={state.users.some(x => x.id === item.id) ? 'online-user-dot connected' : 'online-user-dot'} title={state.users.some(x => x.id === item.id) ? 'В сети' : 'Не в сети'} /><strong title={item.login}>{item.login}</strong></div>
      <RoleChip item={item} editable={admin && item.role !== 'admin'} onChanged={updated => {
        setAccounts(current => current.map(x => x.id === updated.id ? updated : x)); setError('');
      }} onError={setError} />
    </li>)}</ul>
    {error && <p role="alert">{error}</p>}
  </div>;
}
function RoleChip({ item, editable, onChanged, onError }: { item: OnlineUser; editable: boolean; onChanged: (user: OnlineUser) => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [previous, setPrevious] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const name = (role: string) => role === 'admin' ? 'админ' : role === 'editor' ? 'редактор' : 'наблюдатель';
  const change = async () => {
    if (!editable || busy) return;
    setBusy(true);
    try {
      const updated = await onlineRequest<OnlineUser>(`/api/users/${item.id}/role`, 'PUT', { role: item.role === 'editor' ? 'observer' : 'editor' });
      setPrevious(item.role); onChanged(updated);
      timer.current = setTimeout(() => setPrevious(null), 320);
    } catch (e) { onError(e instanceof Error ? e.message : 'Не удалось изменить роль.'); }
    finally { setBusy(false); }
  };
  return <button className={`role-chip${item.role === 'admin' ? ' admin-chip' : ''}${previous ? ' is-switching' : ''}`}
    type="button" disabled={!editable || busy || previous !== null} aria-label={`Роль ${item.login}: ${name(item.role)}`}
    title={editable ? 'Переключить: наблюдатель / редактор' : name(item.role)} onClick={() => void change()}>
    {previous && <span className="role-slide-layer role-slide-out" aria-hidden="true">{name(previous)}</span>}
    <span className={previous ? 'role-label role-slide-in' : 'role-label'}>{busy ? 'сохраняю…' : name(item.role)}</span>
  </button>;
}
