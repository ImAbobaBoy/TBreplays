import { useMemo, useRef, useState } from 'react';

import type { MapCalibration } from '../domain/MapCalibration';
import type { ReplayPlaybackState } from '../domain/ReplayModels';
import type { ManualTankModel } from '../domain/TankModels';
import { ViewerHost } from '../engine/ViewerHost';
import { CalibrationPanel } from '../features/calibration/CalibrationPanel';
import { ReplayControls } from '../features/replay/ReplayControls';
import { WorkspacePanel } from '../features/workspace/WorkspacePanel';
import type { ViewerEngine } from '../engine/ViewerEngine';
import type { AppMode } from './AppMode';
import { createInitialAppState } from './AppState';
import type { ViewerTool } from './AppState';

type InspectorTab = 'tactics' | 'replay' | 'layers';

const toolLabels: Record<ViewerTool, string> = {
  select: 'Камера / выбор',
  draw: 'Рисование линии',
  erase: 'Ластик по линии',
  marker: 'Метки',
  tankPlacement: 'Постановка танка',
  tankAim: 'Прострел / башня',
};

export function App() {
  const [state, setState] = useState(createInitialAppState);
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
    viewerEngineRef.current?.clearDrawings();

    setState((current) => ({
      ...current,
      status: 'Рисунки очищены.',
    }));
  };

  const addManualTank = (tank: ManualTankModel) => {
    setState((current) => ({
      ...current,
      manualTanks: [
        ...current.manualTanks,
        tank,
      ],
      selectedManualTankId: tank.id,
      selectedTool: 'select',
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
    setState((current) => {
      if (!current.selectedManualTankId) {
        return current;
      }

      return {
        ...current,
        manualTanks: current.manualTanks.filter((tank) => {
          return tank.id !== current.selectedManualTankId;
        }),
        selectedManualTankId: null,
        status: 'Танк удалён.',
      };
    });
  };

  const clearManualTanks = () => {
    viewerEngineRef.current?.clearManualTanks();

    setState((current) => ({
      ...current,
      manualTanks: [],
      selectedManualTankId: null,
      status: 'Ручные танки очищены.',
    }));
  };

  const handleReplayPlaybackChanged = (playback: ReplayPlaybackState) => {
    setState((current) => ({
      ...current,
      playback,
    }));
  };

  const importLocalReplay = async () => {
    if (!viewerEngineRef.current) {
      setStatus('ViewerEngine ещё не готов.');
      return;
    }

    try {
      setStatus('Импортирую локальный replay...');

      const replayId = await viewerEngineRef.current.importLocalReplay();

      setState((current) => ({
        ...current,
        replayId,
        status: `Replay импортирован: ${replayId}`,
      }));
    } catch (error) {
      console.error(error);

      setStatus(error instanceof Error
        ? error.message
        : 'Неизвестная ошибка импорта replay.');
    }
  };

  const loadReplay = async () => {
    const replayId = state.replayId.trim();

    if (!replayId) {
      setStatus('Вставь Replay ID или сначала импортируй локальный replay.');
      return;
    }

    if (!viewerEngineRef.current) {
      setStatus('ViewerEngine ещё не готов.');
      return;
    }

    try {
      setStatus('Загружаю replay parse-result...');

      const summary = await viewerEngineRef.current.loadReplay(replayId);
      const playback = viewerEngineRef.current.getReplayPlaybackState();

      setState((current) => ({
        ...current,
        replayLoaded: true,
        playback,
        status: `Replay загружен: tanks=${summary.trackCount}, points=${summary.sampleCount}`,
      }));
    } catch (error) {
      console.error(error);

      setState((current) => ({
        ...current,
        replayLoaded: false,
        playback: {
          ...current.playback,
          replayId: null,
          time: 0,
          minTime: 0,
          maxTime: 0,
          isPlaying: false,
          revision: current.playback.revision + 1,
        },
        status: error instanceof Error
          ? error.message
          : 'Неизвестная ошибка загрузки replay.',
      }));
    }
  };

  const playReplay = () => {
    if (!viewerEngineRef.current) {
      setStatus('ViewerEngine ещё не готов.');
      return;
    }

    const playback = viewerEngineRef.current.playReplay();

    handleReplayPlaybackChanged(playback);
  };

  const pauseReplay = () => {
    if (!viewerEngineRef.current) {
      setStatus('ViewerEngine ещё не готов.');
      return;
    }

    const playback = viewerEngineRef.current.pauseReplay();

    handleReplayPlaybackChanged(playback);
  };

  const seekReplayBy = (deltaSeconds: number) => {
    if (!viewerEngineRef.current) {
      setStatus('ViewerEngine ещё не готов.');
      return;
    }

    const playback = viewerEngineRef.current.seekReplayBy(deltaSeconds);

    handleReplayPlaybackChanged(playback);
  };

  const seekReplayTo = (time: number) => {
    if (!viewerEngineRef.current) {
      setStatus('ViewerEngine ещё не готов.');
      return;
    }

    const playback = viewerEngineRef.current.seekReplayTo(time);

    handleReplayPlaybackChanged(playback);
  };

  const setReplaySpeed = (speed: number) => {
    if (!viewerEngineRef.current) {
      setStatus('ViewerEngine ещё не готов.');
      return;
    }

    const playback = viewerEngineRef.current.setReplaySpeed(speed);

    handleReplayPlaybackChanged(playback);
  };

  const loadMap = async () => {
    const mapId = state.mapId.trim();

    if (!mapId) {
      setStatus('Вставь Map ID.');
      return;
    }

    if (!viewerEngineRef.current) {
      setStatus('ViewerEngine ещё не готов.');
      return;
    }

    try {
      setStatus('Загружаю карту...');

      await viewerEngineRef.current.loadMap(mapId);

      const calibration = viewerEngineRef.current.getCurrentCalibration();
      const playback = viewerEngineRef.current.getReplayPlaybackState();

      setState((current) => ({
        ...current,
        calibration,
        manualTanks: [],
        selectedManualTankId: null,
        replayLoaded: false,
        playback,
        mapLoaded: true,
        status: `Карта загружена: ${mapId}`,
      }));
    } catch (error) {
      console.error(error);

      setState((current) => ({
        ...current,
        calibration: null,
        mapLoaded: false,
        status: error instanceof Error
          ? error.message
          : 'Неизвестная ошибка загрузки карты.',
      }));
    }
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
          onImportLocalReplay={importLocalReplay}
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
              className={state.mode === 'workspace' ? 'active' : ''}
              onClick={() => setMode('workspace')}
            >
              Рабочая поверхность
            </button>

            <button
              className={state.mode === 'debugCalibration' ? 'active' : ''}
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
          {state.mode === 'workspace' ? (
            <WorkspacePanel
              state={state}
              onMapIdChange={setMapId}
              onReplayIdChange={setReplayId}
              onLoadMap={loadMap}
              onImportLocalReplay={importLocalReplay}
              onLoadReplay={loadReplay}
              onSelectedToolChange={setSelectedTool}
              onDrawingColorChange={setDrawingColor}
              onClearDrawings={clearDrawings}
              onManualTankChange={updateManualTank}
              onDeleteSelectedManualTank={deleteSelectedManualTank}
              onClearManualTanks={clearManualTanks}
            />
          ) : (
            <CalibrationPanel
              state={state}
              onMapIdChange={setMapId}
              onReplayIdChange={setReplayId}
              onLoadMap={loadMap}
              onCalibrationChange={setCalibration}
              onPreviewCalibration={previewCalibration}
              onSaveCalibration={saveCalibration}
            />
          )}
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
            manualTanks={state.manualTanks}
            selectedManualTankId={state.selectedManualTankId}
            onTankCreated={addManualTank}
            onTankChanged={updateManualTank}
            onTankSelected={selectManualTank}
            onReplayPlaybackChanged={handleReplayPlaybackChanged}
            onEngineReady={(engine) => {
              viewerEngineRef.current = engine;
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
        TODO: Для будущего совместного просмотра через SignalR синхронизировать только команды loadReplay, play, pause, seek, changeSpeed. Не слать позиции танков/HP/траектории каждый кадр.
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
