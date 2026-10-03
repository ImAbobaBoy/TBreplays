import { useEffect, useState } from 'react';
import { useMapCatalog } from '../maps/MapCatalog';
import { useOnline } from './OnlineRoot';
import { onlineRequest } from '../../api/OnlineHttp';

export function OnlineMapControls() {
  const { state, client, canEdit } = useOnline();
  const { maps: availableWorkspaceMaps, loading, error: catalogError, reload } = useMapCatalog();
  const [mapId, setMapId] = useState('');
  useEffect(() => { if (!mapId && availableWorkspaceMaps.length) setMapId(availableWorkspaceMaps[0].id); }, [availableWorkspaceMaps, mapId]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = async (clear: boolean) => {
    const board = state.board;
    if (!canEdit || !board) return;
    if (!window.confirm(clear ? 'Очистить рисунки для всех участников?' : 'Сменить общую карту и удалить рисунки и танковые метки для всех участников?')) return;
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
      <option value="" disabled>{loading ? 'Загрузка карт…' : 'Выберите карту'}</option>{availableWorkspaceMaps.map(map => <option key={map.id} value={map.id}>{map.title}</option>)}
    </select>
    <button disabled={loading} onClick={() => void reload()}>Обновить список карт</button>
    {catalogError && <p role="alert">{catalogError}</p>}
    {!loading && !availableWorkspaceMaps.length && <p>Карты ещё не импортированы.</p>}
    <button disabled={!canEdit || busy || !mapId.trim()} onClick={() => void apply(false)}>Выбрать для всех</button>
    <button disabled={!canEdit || busy || !state.board?.mapId} onClick={() => void apply(true)}>Очистить рисунки</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
