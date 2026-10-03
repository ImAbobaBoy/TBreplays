import { useOnlineReplay } from '../features/online/useOnlineReplay';
import type { ReplayCommand } from '../features/online/OnlineModels';
import { useOnlineTanks } from '../features/online/useOnlineTanks';
import { useOnline } from '../features/online/OnlineRoot';
import { useOnlineViewer } from '../features/online/useOnlineViewer';
import { useMemo, useRef, useState } from 'react';

import type { MapCalibration } from '../domain/MapCalibration';
import type {
  ReplayImportBatchResult,
  ReplayPlaybackState,
  ReplaySessionItem,
} from '../domain/ReplayModels';
import type { ManualTankModel } from '../domain/TankModels';
import { ViewerHost } from '../engine/ViewerHost';
import { CalibrationPanel } from '../features/calibration/CalibrationPanel';
import { ReplayControls } from '../features/replay/ReplayControls';
import { UserWorkspace } from '../features/userWorkspace/UserWorkspace';
import type { ViewerEngine } from '../engine/ViewerEngine';
import { createEmptyStrategySnapshot } from '../domain/WorkspaceModels';
import type { StrategySnapshot } from '../domain/WorkspaceModels';
import type { AppMode } from './AppMode';
import { createInitialAppState } from './AppState';
import type {
  DrawingArrowMode,
  DrawingLineStyle,
  ViewerTool,
} from './AppState';

type InspectorTab = 'tactics' | 'replay' | 'layers';

const toolLabels: Record<ViewerTool, string> = {
  select: 'Камера / выбор',
  drawLine: 'Прямая линия',
  draw: 'Кривая линия',
  erase: 'Ластик по линии',
  marker: 'Метки',
  text: 'Текст',
  tankPlacement: 'Постановка танка',
  tankAim: 'Прострел / башня',
};

export function App() {
  const online = useOnline();
  const [onlineEngine, setOnlineEngine] = useState<ViewerEngine | null>(null);
  const [state, setState] = useState(createInitialAppState);
  const onlineTanks = useOnlineTanks(onlineEngine, tanks => setState(current => ({
    ...current, manualTanks: tanks,
    selectedManualTankId: tanks.some(x => x.id === current.selectedManualTankId) ? current.selectedManualTankId : null,
  })));
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('tactics');
  const viewerEngineRef = useRef<ViewerEngine | null>(null);

  const title = useMemo(() => {
    return state.mode === 'workspace'
      ? 'Рабочая поверхность'
      : 'Debug / калибровка';
  }, [state.mode]);

  const selectedTank = useMemo(() => {
    return state.manualTanks.find((tank) => {
      return tank.id === state.selectedManualTankId;
    }) ?? null;
  }, [state.manualTanks, state.selectedManualTankId]);

  const setMode = (mode: AppMode) => {
    if (mode === 'debugCalibration' && online.user.role !== 'admin') return;
    setState((current) => ({
      ...current,
      mode,
    }));
  };

  const setMapId = (mapId: string) => {
    setState((current) => ({
      ...current,
      mapId,
    }));
  };

  const setReplayId = (replayId: string) => {
    setState((current) => ({
      ...current,
      replayId,
    }));
  };

  const setSelectedTool = (selectedTool: ViewerTool) => {
    if (selectedTool !== 'select' && !online.canEdit) return;
    setState((current) => ({
      ...current,
      selectedTool,
    }));
  };

  const setDrawingColor = (drawingColor: string) => {
    setState((current) => ({
      ...current,
      drawingColor,
    }));
  };

  const setDrawingWidth = (drawingWidth: number) => {
    setState((current) => ({
      ...current,
      drawingWidth,
    }));
  };

  const setDrawingLineStyle = (drawingLineStyle: DrawingLineStyle) => {
    setState((current) => ({
      ...current,
      drawingLineStyle,
    }));
  };

  const setDrawingArrowMode = (drawingArrowMode: DrawingArrowMode) => {
    setState((current) => ({
      ...current,
      drawingArrowMode,
    }));
  };

  const setStatus = (status: string) => {
    setState((current) => ({
      ...current,
      status,
    }));
  };

  const setCalibration = (calibration: MapCalibration) => {
    setState((current) => ({
      ...current,
      calibration,
    }));
  };

  const clearDrawings = () => {
    const board = online.state.board;
    if (online.canEdit && board) void online.client.apply({ kind: 'clear', expectedRevision: board.revision }).catch(() => {});
  };

  const addManualTank = (tank: ManualTankModel) => {
    setState((current) => ({
      ...current,
      manualTanks: [
        ...current.manualTanks,
        tank,
      ],
      selectedManualTankId: null,
      status: `Танк добавлен: ${tank.label}`,
    }));
  };

  const updateManualTank = (tank: ManualTankModel) => {
    setState((current) => ({
      ...current,
      manualTanks: current.manualTanks.map((item) => {
        return item.id === tank.id
          ? tank
          : item;
      }),
    }));
  };

  const selectManualTank = (tankId: string | null) => {
    setState((current) => ({
      ...current,
      selectedManualTankId: tankId,
    }));
  };

  const deleteSelectedManualTank = () => {
    if (state.selectedManualTankId) onlineTanks.remove(state.selectedManualTankId);
  };
  const clearManualTanks = () => onlineTanks.clear();

  const exportStrategyPng = async () => {
    if (!viewerEngineRef.current) {
      setStatus('ViewerEngine ещё не готов.');
      return;
    }

    try {
      setStatus('Готовлю PNG-экспорт тактики...');

      const fileName = await viewerEngineRef.current.exportStrategyPng();

      setStatus(`PNG-экспорт готов: ${fileName}`);
    } catch (error) {
      console.error(error);

      setStatus(error instanceof Error
        ? error.message
        : 'Неизвестная ошибка PNG-экспорта.');
      throw error;
    }
  };

  const handleReplayPlaybackChanged = (playback: ReplayPlaybackState) => {
    const replayTeamHealth = viewerEngineRef.current?.getReplayTeamHealthState(playback.time) ?? null;

    setState((current) => ({
      ...current,
      playback,
      replayTeamHealth,
    }));
  };

  const autoImportLocalReplay = async () => {
    if (online.user.role === 'observer') return;
    if (!viewerEngineRef.current) {
      return;
    }

    try {
      // TODO: Временное MVP-решение.
      // Сейчас старый dev-flow parse-local запускается автоматически после реальной загрузки карты.
      // Потом заменить на нормальный import queue / replay library без скрытого чтения ReplayFiles.
      // Убрать автоимпорт из загрузки карты, когда загрузка replay через сайт полностью заменит local dev-flow.
      await viewerEngineRef.current.importLocalReplay();
    } catch (error) {
      console.debug('Локальный replay для автоимпорта не импортирован.', error);
    }
  };

  const importReplayFiles = async (files: File[]): Promise<ReplayImportBatchResult | null> => {
    if (online.user.role === 'observer' || online.state.status !== 'connected') return null;
    if (!viewerEngineRef.current) {
      setStatus('ViewerEngine ещё не готов.');
      return null;
    }

    try {
      setStatus(`Импортирую replay-файлы: ${files.length}...`);

      const result = await viewerEngineRef.current.importReplayFiles(files);
      const successCount = result.items.filter((item) => item.success).length;
      const failedCount = result.items.length - successCount;

      setStatus(`Replay import: успешно ${successCount}, ошибок ${failedCount}.`);

      const first = result.items.find(item => item.success && item.replayId);
      if (first?.replayId) await online.client.replayCommand({ kind: 'load', replayId: first.replayId });
      return result;
    } catch (error) {
      console.error(error);

      setStatus(error instanceof Error
        ? error.message
        : 'Неизвестная ошибка загрузки replay через сайт.');

      return null;
    }
  };

  const loadCurrentSessionReplays = async (mapName: string): Promise<ReplaySessionItem[]> => {
    if (!viewerEngineRef.current) {
      return [];
    }

    try {
      return await viewerEngineRef.current.getCurrentSessionReplays(mapName);
    } catch (error) {
      console.error(error);

      setStatus(error instanceof Error
        ? error.message
        : 'Неизвестная ошибка загрузки replay текущей сессии.');

      return [];
    }
  };

  const commandReplay = async (command: ReplayCommand) => {
    if (online.user.role === 'observer') return;
    await online.client.replayCommand(command);
  };
  const loadReplayById = async (id: string) => { await commandReplay({ kind: 'load', replayId: id.trim() }); };
  const loadReplay = async () => { await loadReplayById(state.replayId); };
  const detachReplay = () => { void commandReplay({ kind: 'unload' }); };
  const playReplay = () => { void commandReplay({ kind: 'play' }); };
  const pauseReplay = () => { void commandReplay({ kind: 'pause' }); };
  const seekReplayTo = (time: number) => { void commandReplay({ kind: 'seek', time }); };
  const seekReplayBy = (delta: number) => seekReplayTo((viewerEngineRef.current?.getReplayPlaybackState().time ?? 0) + delta);
  const setReplaySpeed = (speed: number) => { void commandReplay({ kind: 'speed', speed }); };

  const loadMapById = async (rawMapId: string) => {
    const mapId = rawMapId.trim();

    if (!mapId) {
      setStatus('Вставь Map ID.');
      return;
    }

    if (!viewerEngineRef.current) {
      setStatus('ViewerEngine ещё не готов.');
      return;
    }

    const engine = viewerEngineRef.current;
    try {
      setState(current => ({ ...current, mapLoaded: false, status: 'Загружаю карту...' }));

      await engine.loadMap(mapId);
      if (viewerEngineRef.current !== engine) return;

      const calibration = engine.getCurrentCalibration();
      const playback = engine.getReplayPlaybackState();

      setState((current) => ({
        ...current,
        mapId,
        calibration,
        manualTanks: online.client.getSnapshot().board?.mapId === mapId
          ? (online.client.getSnapshot().board?.tanks ?? []).map(x => x.tank) : [],
        selectedManualTankId: null,
        replayLoaded: false,
        playback,
        replayTeamHealth: null,
        mapLoaded: true,
        status: `Карта загружена: ${mapId}`,
      }));
    } catch (error) {
      if (viewerEngineRef.current !== engine) return;
      console.error(error);

      setState((current) => ({
        ...current,
        mapId,
        calibration: null,
        mapLoaded: false,
        status: error instanceof Error
          ? error.message
          : 'Неизвестная ошибка загрузки карты.',
      }));
      throw error;
    }
  };

  const loadMap = async () => {
    try { await loadMapById(state.mapId); } catch { /* Status already contains the load error. */ }
  };

  const commonMapReady = useOnlineViewer(onlineEngine, loadMapById, state.mode, setStatus);
  const replaySync = useOnlineReplay(onlineEngine, commonMapReady && state.mapLoaded && state.mapId === online.state.board?.mapId, id => {
    const playback = onlineEngine?.getReplayPlaybackState() ?? state.playback;
    setState(current => ({ ...current, replayId: id ?? '', replayLoaded: id !== null,
      playback, replayTeamHealth: id ? onlineEngine?.getReplayTeamHealthState(playback.time) ?? null : null }));
  }, setStatus);

  const captureStrategySnapshot = (): StrategySnapshot => {
    if (!viewerEngineRef.current) {
      return createEmptyStrategySnapshot();
    }

    return viewerEngineRef.current.captureStrategySnapshot(state.selectedManualTankId);
  };

  const applyStrategySnapshot = (snapshot: StrategySnapshot) => {
    viewerEngineRef.current?.applyStrategySnapshot(snapshot);

    setState((current) => ({
      ...current,
      manualTanks: snapshot.manualTanks,
      selectedManualTankId: snapshot.selectedManualTankId,
      selectedTool: 'select',
      status: 'Слайд переключён: локальная тактика восстановлена из памяти frontend.',
    }));
  };

  const previewCalibration = async () => {
    if (!state.calibration) {
      setStatus('Калибровка ещё не загружена.');
      return;
    }

    if (!viewerEngineRef.current) {
      setStatus('ViewerEngine ещё не готов.');
      return;
    }

    try {
      setStatus('Применяю калибровку в viewer...');

      await viewerEngineRef.current.previewCalibration(state.calibration);

      setStatus('Калибровка применена в viewer.');
    } catch (error) {
      console.error(error);

      setStatus(error instanceof Error
        ? error.message
        : 'Неизвестная ошибка применения калибровки.');
    }
  };

  const saveCalibration = async () => {
    const mapId = state.mapId.trim();

    if (!mapId || !state.calibration) {
      setStatus('Сначала загрузи карту и калибровку.');
      return;
    }

    if (!viewerEngineRef.current) {
      setStatus('ViewerEngine ещё не готов.');
      return;
    }

    try {
      setStatus('Сохраняю map_calibration.json...');

      const saved = await viewerEngineRef.current.saveCalibration(
        mapId,
        state.calibration,
      );

      setState((current) => ({
        ...current,
        calibration: saved,
        status: 'Калибровка сохранена.',
      }));
    } catch (error) {
      console.error(error);

      setStatus(error instanceof Error
        ? error.message
        : 'Неизвестная ошибка сохранения калибровки.');
    }
  };

  if (state.mode === 'workspace') {
    return (
      <UserWorkspace
        replaySyncError={replaySync.error}
        onRetryReplay={replaySync.retry}
        state={state}
        selectedTank={selectedTank}
        onModeChange={setMode}
        onMapIdChange={setMapId}
        onReplayIdChange={setReplayId}
        onLoadMapById={loadMapById}
        onAutoImportLocalReplay={autoImportLocalReplay}
        onImportReplayFiles={importReplayFiles}
        onLoadCurrentSessionReplays={loadCurrentSessionReplays}
        onLoadReplay={loadReplay}
        onLoadReplayById={loadReplayById}
        onDetachReplay={detachReplay}
        onSelectedToolChange={setSelectedTool}
        onDrawingColorChange={setDrawingColor}
        onDrawingWidthChange={setDrawingWidth}
        onDrawingLineStyleChange={setDrawingLineStyle}
        onDrawingArrowModeChange={setDrawingArrowMode}
        onClearDrawings={clearDrawings}
        onManualTankChange={onlineTanks.commit}
        onDeleteSelectedManualTank={deleteSelectedManualTank}
        onClearManualTanks={clearManualTanks}
        onExportStrategyPng={exportStrategyPng}
        onCaptureStrategySnapshot={captureStrategySnapshot}
        onApplyStrategySnapshot={applyStrategySnapshot}
        onTankCreated={addManualTank}
        onTankChanged={updateManualTank}
        onTankSelected={selectManualTank}
        onReplayPlaybackChanged={handleReplayPlaybackChanged}
        onEngineReady={(engine) => {
          viewerEngineRef.current = engine;
          setOnlineEngine(engine);
        }}
        onPlayReplay={playReplay}
        onPauseReplay={pauseReplay}
        onSeekReplayBy={seekReplayBy}
        onSeekReplayTo={seekReplayTo}
        onReplaySpeedChange={setReplaySpeed}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand-cluster">
          <div className="brand-emblem">TB</div>

          <div className="brand-copy">
            <div className="brand-title">TB Replay Workbench</div>
            <div className="brand-subtitle">{state.mapId || 'Карта не выбрана'}</div>
          </div>
        </div>

        <ReplayControls
          state={state}
          variant="top"
          onReplayIdChange={setReplayId}
          onLoadReplay={loadReplay}
          onPlayReplay={playReplay}
          onPauseReplay={pauseReplay}
          onSeekReplayBy={seekReplayBy}
          onSeekReplayTo={seekReplayTo}
          onReplaySpeedChange={setReplaySpeed}
        />

        <div className="top-actions">
          <div className="mode-switch" aria-label="Режим интерфейса">
            <button
              className=""
              onClick={() => setMode('workspace')}
            >
              Рабочая поверхность
            </button>

            <button
              className="active"
              onClick={() => setMode('debugCalibration')}
            >
              Debug / калибровка
            </button>
          </div>

          <StatusPill tone={state.status.toLowerCase().includes('ошибка') ? 'danger' : 'success'}>
            {state.status}
          </StatusPill>
        </div>
      </header>

      <main className="main-layout">
        <aside className="left-panel">
          <CalibrationPanel
            state={state}
            onMapIdChange={setMapId}
            onReplayIdChange={setReplayId}
            onLoadMap={loadMap}
            onLoadReplay={loadReplay}
            onCalibrationChange={setCalibration}
            onPreviewCalibration={previewCalibration}
            onSaveCalibration={saveCalibration}
          />
        </aside>

        <section className="viewer-section">
          <div className="viewer-top-strip">
            <StatusPill tone={state.mapLoaded ? 'success' : 'muted'}>
              {`Карта: ${state.mapLoaded ? 'загружена' : 'нет'}`}
            </StatusPill>

            <StatusPill tone={state.replayLoaded ? 'success' : 'muted'}>
              {`Replay: ${state.replayLoaded ? 'загружен' : 'нет'}`}
            </StatusPill>

            <StatusPill tone={state.calibration ? 'warning' : 'muted'}>
              {`Calibration: ${state.calibration ? 'черновик' : 'нет'}`}
            </StatusPill>
          </div>

          <ViewerHost
            mode={state.mode}
            selectedTool={state.selectedTool}
            drawingColor={state.drawingColor}
            drawingWidth={state.drawingWidth}
            drawingLineStyle={state.drawingLineStyle}
            drawingArrowMode={state.drawingArrowMode}
            manualTanks={state.manualTanks}
            selectedManualTankId={state.selectedManualTankId}
            onTankCreated={addManualTank}
            onTankChanged={updateManualTank}
            onTankSelected={selectManualTank}
            onReplayPlaybackChanged={handleReplayPlaybackChanged}
            onEngineReady={(engine) => {
              viewerEngineRef.current = engine;
          setOnlineEngine(engine);
            }}
          />
        </section>

        <aside className="right-panel">
          <section className="panel-card inspector-card">
            <div className="panel-tabs" role="tablist" aria-label="Правая панель">
              <button
                className={inspectorTab === 'tactics' ? 'active' : ''}
                onClick={() => setInspectorTab('tactics')}
              >
                Тактики
              </button>

              <button
                className={inspectorTab === 'replay' ? 'active' : ''}
                onClick={() => setInspectorTab('replay')}
              >
                Replay
              </button>

              <button
                className={inspectorTab === 'layers' ? 'active' : ''}
                onClick={() => setInspectorTab('layers')}
              >
                Слои
              </button>
            </div>

            {inspectorTab === 'tactics' && (
              <TacticsInspector
                state={state}
                selectedTank={selectedTank}
              />
            )}

            {inspectorTab === 'replay' && (
              <ReplayInspector state={state} />
            )}

            {inspectorTab === 'layers' && (
              <LayersInspector state={state} />
            )}
          </section>

          <section className="panel-card status-card">
            <div className="panel-title">Текущий контекст</div>

            <MetadataRow label="Режим" value={title} />
            <MetadataRow label="Инструмент" value={toolLabels[state.selectedTool]} />
            <MetadataRow label="Map ID" value={state.mapId || '—'} />
            <MetadataRow label="Replay ID" value={state.replayId || '—'} />
            <MetadataRow label="Танки" value={String(state.manualTanks.length)} />
          </section>
        </aside>
      </main>

      <footer className="bottom-status-bar">
        <div>Карта: <strong>{state.mapId || '—'}</strong></div>
        <div>Инструмент: <strong>{toolLabels[state.selectedTool]}</strong></div>
        <div>Выбрано: <strong>{selectedTank?.label ?? '0 объектов'}</strong></div>
        <div className="bottom-status-fill">{state.status}</div>
      </footer>
    </div>
  );
}

function TacticsInspector({
  state,
  selectedTank,
}: {
  state: ReturnType<typeof createInitialAppState>;
  selectedTank: ManualTankModel | null;
}) {
  return (
    <div className="inspector-body">
      <div className="inspector-heading-row">
        <div>
          <div className="panel-title">Тактическая разметка</div>
          <div className="panel-caption">Линии, ручные танки и прострелы текущей сессии</div>
        </div>

        <button className="ghost-button" disabled>
          + Новая тактика
        </button>
      </div>

      <div className="tactic-list">
        <div className="tactic-card active">
          <div className="tactic-thumb">MAP</div>
          <div className="tactic-copy">
            <strong>{state.mapId ? 'Текущая рабочая сессия' : 'Сессия без карты'}</strong>
            <span>{state.mapId || 'Сначала загрузи карту'}</span>
            <small>{state.manualTanks.length} ручн. танков · инструмент {toolLabels[state.selectedTool]}</small>
          </div>
        </div>

        <div className="empty-note">
          Здесь позже будет список сохранённых тактик по карте. Сейчас не добавляю фейковую бизнес-логику — только отображаю активную сессию.
        </div>
      </div>

      <div className="panel-subtitle">Текущий выбор</div>

      {selectedTank ? (
        <div className="selection-card">
          <MetadataRow label="Танк" value={selectedTank.label} />
          <MetadataRow label="Команда" value={formatTeam(selectedTank.team)} />
          <MetadataRow label="Тип" value={formatTankType(selectedTank.visualKey)} />
          <MetadataRow label="Корпус" value={`${selectedTank.pose.bodyYawDegrees.toFixed(0)}°`} />
          <MetadataRow label="Башня" value={`${selectedTank.pose.turretYawDegrees.toFixed(0)}°`} />
        </div>
      ) : (
        <div className="empty-note">
          Поставь танк или выбери существующий на terrain, чтобы здесь появились быстрые сведения.
        </div>
      )}
    </div>
  );
}

function ReplayInspector({
  state,
}: {
  state: ReturnType<typeof createInitialAppState>;
}) {
  return (
    <div className="inspector-body">
      <div className="panel-title">Текущий replay</div>
      <MetadataRow label="Replay ID" value={(state.playback.replayId ?? state.replayId) || '—'} />
      <MetadataRow label="Статус" value={state.replayLoaded ? 'Загружен' : 'Не загружен'} />
      <MetadataRow label="Время" value={`${state.playback.time.toFixed(2)} / ${state.playback.maxTime.toFixed(2)} с`} />
      <MetadataRow label="Скорость" value={`x${state.playback.speed}`} />
      <MetadataRow label="Плеер" value={state.playback.isPlaying ? 'Идёт' : 'Пауза'} />

      <div className="empty-note">
        Общий реплей управляется командами. Ведущий сверяет время каждые 5 секунд; позиции танков рассчитываются в браузере.
      </div>
    </div>
  );
}

function LayersInspector({
  state,
}: {
  state: ReturnType<typeof createInitialAppState>;
}) {
  return (
    <div className="inspector-body">
      <div className="panel-title">Слои viewer</div>

      <LayerRow label="Terrain" enabled={state.mapLoaded} />
      <LayerRow label="Surface texture" enabled={state.mapLoaded} />
      <LayerRow label="Replay tracks" enabled={state.replayLoaded} />
      <LayerRow label="Manual tanks" enabled={state.manualTanks.length > 0} />
      <LayerRow label="Drawing" enabled />

      <div className="empty-note">
        Это пока диагностический список. Переключатели видимости слоёв лучше подключать отдельно, когда появятся callbacks из ViewerEngine.
      </div>
    </div>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'danger' | 'muted';
  children: string;
}) {
  return (
    <span className={`status-pill status-pill--${tone}`} title={children}>
      {children}
    </span>
  );
}

function MetadataRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="kv wide-kv">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function LayerRow({
  label,
  enabled,
}: {
  label: string;
  enabled: boolean;
}) {
  return (
    <div className="layer-row">
      <span>{label}</span>
      <StatusPill tone={enabled ? 'success' : 'muted'}>
        {enabled ? 'активен' : 'нет данных'}
      </StatusPill>
    </div>
  );
}

function formatTeam(team: ManualTankModel['team']): string {
  if (team === 'ally') {
    return 'Союзник';
  }

  if (team === 'enemy') {
    return 'Противник';
  }

  return 'Нейтральный';
}

function formatTankType(visualKey: ManualTankModel['visualKey']): string {
  if (visualKey === 'light') {
    return 'Лёгкий';
  }

  if (visualKey === 'heavy') {
    return 'Тяжёлый';
  }

  if (visualKey === 'td') {
    return 'ПТ-САУ';
  }

  return 'Средний';
}
