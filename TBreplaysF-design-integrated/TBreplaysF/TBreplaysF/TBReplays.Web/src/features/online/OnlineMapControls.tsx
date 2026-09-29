import { useState } from 'react';
import { availableWorkspaceMaps } from '../../domain/WorkspaceModels';
import { useOnline } from './OnlineRoot';
import { onlineRequest } from '../../api/OnlineHttp';

export function OnlineMapControls() {
  const { state, client, canEdit } = useOnline();
  const [mapId, setMapId] = useState(availableWorkspaceMaps[0].id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = async (clear: boolean) => {
    const board = state.board;
    if (!canEdit || !board) return;
    if (!window.confirm(clear ? 'Очистить рисунки для всех участников?' : 'Сменить общую карту и очистить рисунки для всех участников?')) return;
    setBusy(true); setError('');
    try {
      const id = mapId.trim();
      if (!clear) await onlineRequest(`/api/maps/${encodeURIComponent(id)}/manifest`);
      await client.apply({ kind: clear ? 'clear' : 'setMap', expectedRevision: board.revision, ...(clear ? {} : { mapId: id }) });
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось изменить доску.'); }
    finally { setBusy(false); }
  };
  return <section className="panel online-map-controls"><strong>Общая карта</strong>
    <p>{state.board?.mapId ?? 'Редактор должен выбрать карту'}</p>
    <select aria-label="Карта из каталога" value={availableWorkspaceMaps.some(x => x.id === mapId) ? mapId : ''} disabled={!canEdit || busy} onChange={e => setMapId(e.target.value)}>
      <option value="" disabled>Другой Map ID</option>{availableWorkspaceMaps.map(map => <option key={map.id} value={map.id}>{map.title}</option>)}
    </select>
    <input aria-label="Map ID общей карты" placeholder="Map ID импортированной карты" disabled={!canEdit || busy} value={mapId} onChange={e => setMapId(e.target.value)} />
    <button disabled={!canEdit || busy || !mapId.trim()} onClick={() => void apply(false)}>Выбрать для всех</button>
    <button disabled={!canEdit || busy || !state.board?.mapId} onClick={() => void apply(true)}>Очистить рисунки</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
