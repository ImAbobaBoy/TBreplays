import { useState } from 'react';
import { createId } from '../../utils/createId';
import { useOnline } from '../online/OnlineRoot';
import { useMapCatalog } from '../maps/MapCatalog';
import { MapPreview } from '../maps/MapPreview';
import type { WorkspaceSlide } from '../online/OnlineModels';

export function WorkspaceSlides() {
  const { client, state, canEdit } = useOnline();
  const { maps } = useMapCatalog();
  const slides = state.workspace?.slides ?? [];
  const active = state.workspace?.activeSlideId;
  const index = slides.findIndex(slide => slide.id === active);
  const locked = !!state.workspace?.presenterId && state.workspace.presenterConnectionId !== state.connectionId;
  const [dialog, setDialog] = useState<{ replace?: WorkspaceSlide } | null>(null);
  const [selectedMap, setSelectedMap] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{ slide: WorkspaceSlide; x: number; y: number } | null>(null);
  const action = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось изменить слайды.'); }
    finally { setBusy(false); }
  };
  const open = (replace?: WorkspaceSlide) => { setSelectedMap(replace?.mapId ?? maps[0]?.id ?? ''); setSearch(''); setDialog({ replace }); setMenu(null); };
  const add = () => action(async () => {
    const map = maps.find(item => item.id === selectedMap);
    if (!map) return;
    const id = createId();
    await client.workspaceCommand({ kind: dialog?.replace ? 'replace' : 'add', slideId: id, mapId: map.id, title: dialog?.replace?.title ?? map.title, sourceSlideId: dialog?.replace?.id });
    await client.selectSlide(id); setDialog(null);
  });
  const remove = (id: string) => action(() => client.workspaceCommand({ kind: 'delete', slideId: id }));
  const duplicate = (slide: WorkspaceSlide) => action(async () => {
    const id = createId();
    await client.workspaceCommand({ kind: 'add', slideId: id, mapId: slide.mapId, title: (slide.title + ' · копия').slice(0, 80), sourceSlideId: slide.id });
    await client.selectSlide(id);
  });
  const clear = (id: string) => action(async () => {
    await client.selectSlide(id);
    let board = client.getSnapshot().board;
    if (!board) return;
    await client.apply({ kind: 'clear', expectedRevision: board.revision });
    board = client.getSnapshot().board;
    if (board) await client.apply({ kind: 'clearTanks', expectedRevision: board.revision });
  });
  const select = (id: string) => action(() => client.selectSlide(id));
  return <>
    <section className="panel maps-panel">
      <div className="maps-toolbar"><span className="panel-title">Карты</span>
        <div className="toolbar-buttons maps-toolbar-buttons">
          <button className="toolbar-icon-button" aria-label="Назад" disabled={locked || busy || index <= 0} onClick={() => void select(slides[index - 1].id)}><Icon kind="left" /></button>
          <button className="toolbar-icon-button" aria-label="Вперёд" disabled={locked || busy || index < 0 || index >= slides.length - 1} onClick={() => void select(slides[index + 1].id)}><Icon kind="right" /></button>
          <button className="toolbar-icon-button delete-button" aria-label="Удалить выбранную карту" disabled={!canEdit || locked || busy || !active} onClick={() => active && void remove(active)}><Icon kind="trash" /></button>
          <button className="toolbar-add-button" aria-label="Добавить" disabled={!canEdit || locked || busy} onClick={() => open()}><span>Добавить</span><Icon kind="plus" /></button>
        </div>
      </div>
      <div className="map-grid classic-grid">{slides.map((slide, position) => <article key={slide.id} className={slide.id === active ? 'map-card selected' : 'map-card'} role="button" tabIndex={locked ? -1 : 0} aria-disabled={locked || busy} aria-label={`Открыть карту ${position + 1}`} onClick={() => !locked && !busy && void select(slide.id)} onKeyDown={event => { if (!locked && !busy && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); void select(slide.id); } }}>
        <div className="map-thumb-wrap"><span className="map-thumb" title={maps.find(map => map.id === slide.mapId)?.title ?? slide.mapId}><MapPreview mapId={slide.mapId} title={maps.find(map => map.id === slide.mapId)?.title ?? slide.mapId} thumbnail /></span>
          <button className="map-card-more" aria-label={`Действия с картой ${position + 1}`} aria-haspopup="menu" aria-expanded={menu?.slide.id === slide.id} disabled={!canEdit || locked || busy} onClick={event => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setMenu(menu?.slide.id === slide.id ? null : { slide, x: rect.right - 158, y: rect.bottom + 6 }); }}>•••</button>
        </div>
        <SlideTitle slide={slide} disabled={!canEdit || locked || busy} save={title => void action(() => client.workspaceCommand({ kind: 'rename', slideId: slide.id, title }))} />
      </article>)}</div>
      {error && <p className="slide-error" role="alert">{error}</p>}
    </section>
    {dialog && <div className="modal-backdrop" onMouseDown={() => !busy && setDialog(null)}><div className="modal-window add-map-dialog" role="dialog" aria-modal="true" aria-labelledby="addMapModalTitle" onMouseDown={event => event.stopPropagation()}>
      <div className="modal-header add-map-dialog-header"><div><span className="modal-eyebrow">Карты</span><h2 id="addMapModalTitle">{dialog.replace ? 'Сменить карту' : 'Добавить карту'}</h2></div><button className="modal-close" aria-label="Закрыть" disabled={busy} onClick={() => setDialog(null)}><Icon kind="close" /></button></div>
      <div className="modal-body add-map-dialog-body"><div className="map-preview-column"><div className="map-preview-placeholder" aria-label="Превью выбранной карты"><MapPreview mapId={selectedMap} title={maps.find(map => map.id === selectedMap)?.title ?? selectedMap} /><span className="map-preview-selected-name">{maps.find(map => map.id === selectedMap)?.title}</span></div></div>
        <div className="map-picker-column"><label className="map-search-wrap"><Icon kind="search" /><input className="map-search-input" type="search" placeholder="Поиск..." aria-label="Поиск карты" value={search} onChange={event => setSearch(event.target.value)} /></label><div className="map-picker-list" role="listbox" aria-label="Список карт">{maps.filter(map => map.title.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'))).map(map => <button key={map.id} className={selectedMap === map.id ? 'map-picker-item selected' : 'map-picker-item'} role="option" aria-selected={selectedMap === map.id} onClick={() => setSelectedMap(map.id)}>{map.title}</button>)}</div></div>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="add-map-dialog-footer"><button className="confirm-add-map-button" disabled={busy || !selectedMap} onClick={() => void add()}><span>{dialog.replace ? 'Сменить карту' : 'Добавить карту'}</span><Icon kind="right" /></button></div>
    </div></div>}
    {menu && <><div className="slide-menu-backdrop" onClick={() => setMenu(null)} /><div className="map-card-context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
      <button role="menuitem" onClick={() => open(menu.slide)}>Сменить карту</button><button role="menuitem" onClick={() => { void duplicate(menu.slide); setMenu(null); }}>Дублировать</button><button role="menuitem" onClick={() => { void clear(menu.slide.id); setMenu(null); }}>Очистить</button><button role="menuitem" data-map-card-action="delete" onClick={() => { void remove(menu.slide.id); setMenu(null); }}>Удалить</button>
    </div></>}
  </>;
}
function SlideTitle({ slide, disabled, save }: { slide: WorkspaceSlide; disabled: boolean; save: (title: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft !== null && draft.trim() && draft.trim() !== slide.title) save(draft.trim()); setDraft(null); };
  return <input className="map-name-input" value={draft ?? slide.title} aria-label="Название карты" maxLength={80} readOnly={disabled} onClick={event => event.stopPropagation()} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setDraft(null); }} />;
}
function Icon({ kind }: { kind: 'left' | 'right' | 'plus' | 'trash' | 'close' | 'search' }) {
  const paths = { left: 'M12.8 4.5 7.2 10l5.6 5.5', right: 'M7.2 4.5 12.8 10l-5.6 5.5', plus: 'M10 4v12M4 10h12', trash: 'M4 5h12M7 5V3h6v2M6 5l1 12h6l1-12M9 8v6M11 8v6', close: 'M5 5l10 10M15 5 5 15', search: 'M13 13l4 4M14 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0' };
  return <svg viewBox="0 0 20 20" aria-hidden="true" className="toolbar-svg"><path d={paths[kind]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
