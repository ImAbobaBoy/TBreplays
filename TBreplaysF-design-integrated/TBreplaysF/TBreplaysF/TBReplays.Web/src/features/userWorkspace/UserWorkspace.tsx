import { createId } from '../../utils/createId';
import { OnlinePanel, useOnline } from '../online/OnlineRoot';
import { OnlineMapControls } from '../online/OnlineMapControls';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { AppMode } from '../../app/AppMode';
import type {
  AppState,
  DrawingArrowMode,
  DrawingLineStyle,
  ViewerTool,
} from '../../app/AppState';
import type {
  ReplayImportBatchResult,
  ReplayPlaybackState,
  ReplaySessionItem,
} from '../../domain/ReplayModels';
import type {
  ManualTankModel,
  ManualTankPlacementDefaults,
  TankVisualKey,
} from '../../domain/TankModels';
import {
  availableWorkspaceMaps,
  type StrategySnapshot,
} from '../../domain/WorkspaceModels';
import type { ViewerEngine } from '../../engine/ViewerEngine';
import { ReplayBattleOverlay } from '../replay/ReplayBattleOverlay';
import { ViewerHost } from '../../engine/ViewerHost';

type WorkspaceReplayRow = {
  id: string;
  replayId: string;
  mapName: string;
  title: string;
  source: 'session' | 'manual';
  battleDuration: number | null;
  importedAtUtc: string | null;
};

type UserWorkspaceProps = {
  state: AppState;
  selectedTank: ManualTankModel | null;
  onModeChange: (mode: AppMode) => void;
  onMapIdChange: (mapId: string) => void;
  onReplayIdChange: (replayId: string) => void;
  onLoadMapById: (mapId: string) => Promise<void>;
  onAutoImportLocalReplay: () => Promise<void>;
  onImportReplayFiles: (files: File[]) => Promise<ReplayImportBatchResult | null>;
  onLoadCurrentSessionReplays: (mapName: string) => Promise<ReplaySessionItem[]>;
  onLoadReplay: () => Promise<void>;
  onLoadReplayById: (replayId: string) => Promise<void>;
  onDetachReplay: () => void;
  onSelectedToolChange: (tool: ViewerTool) => void;
  onDrawingColorChange: (color: string) => void;
  onDrawingWidthChange: (width: number) => void;
  onDrawingLineStyleChange: (lineStyle: DrawingLineStyle) => void;
  onDrawingArrowModeChange: (arrowMode: DrawingArrowMode) => void;
  onClearDrawings: () => void;
  onManualTankChange: (tank: ManualTankModel) => void;
  onDeleteSelectedManualTank: () => void;
  onClearManualTanks: () => void;
  onExportStrategyPng: () => Promise<void>;
  onCaptureStrategySnapshot: () => StrategySnapshot;
  onApplyStrategySnapshot: (snapshot: StrategySnapshot) => void;
  onTankCreated: (tank: ManualTankModel) => void;
  onTankChanged: (tank: ManualTankModel) => void;
  onTankSelected: (tankId: string | null) => void;
  onReplayPlaybackChanged: (playback: ReplayPlaybackState) => void;
  onEngineReady: (engine: ViewerEngine | null) => void;
  onPlayReplay: () => void;
  onPauseReplay: () => void;
  onSeekReplayBy: (deltaSeconds: number) => void;
  onSeekReplayTo: (time: number) => void;
  onReplaySpeedChange: (speed: number) => void;
};

const colorSliderStops = [
  { position: 0, color: '#ff3b00' },
  { position: 180, color: '#ffd400' },
  { position: 380, color: '#00e35f' },
  { position: 580, color: '#00c9ff' },
  { position: 740, color: '#1d30ff' },
  { position: 1000, color: '#ff00c8' },
];

const initialSwatchPositions = [182, 112, 742, 384, 1000];

const tankTypeOptions: Array<{
  value: TankVisualKey;
  label: string;
}> = [
  { value: 'heavy', label: 'Тяжёлый танк' },
  { value: 'medium', label: 'Средний танк' },
  { value: 'light', label: 'Лёгкий танк' },
  { value: 'td', label: 'ПТ-САУ' },
];

export function UserWorkspace({
  state,
  selectedTank,
  onModeChange,
  onReplayIdChange,
  onImportReplayFiles,
  onLoadCurrentSessionReplays,
  onLoadReplayById,
  onSelectedToolChange,
  onDrawingColorChange,
  onDrawingWidthChange,
  onDrawingLineStyleChange,
  onDrawingArrowModeChange,
  onManualTankChange,
  onDeleteSelectedManualTank,
  onClearManualTanks,
  onExportStrategyPng,
  onTankCreated,
  onTankChanged,
  onTankSelected,
  onReplayPlaybackChanged,
  onEngineReady,
  onPlayReplay,
  onPauseReplay,
  onSeekReplayBy,
  onSeekReplayTo,
}: UserWorkspaceProps) {
  const online = useOnline();
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const exportPng = async () => {
    setExporting(true); setExportStatus('Готовлю PNG…');
    try { await onExportStrategyPng(); setExportStatus('PNG готов.'); }
    catch (error) { setExportStatus(error instanceof Error ? error.message : 'Не удалось создать PNG.'); }
    finally { setExporting(false); }
  };
  const [presentEnabled, setPresentEnabled] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [markerLabel, setMarkerLabel] = useState('амус');
  const [markerTankType, setMarkerTankType] = useState<TankVisualKey>('heavy');
  const [replays, setReplays] = useState<WorkspaceReplayRow[]>([]);
  const [viewerReady, setViewerReady] = useState(false);
  const [selectedSwatchIndex, setSelectedSwatchIndex] = useState(0);
  const [swatchPositions, setSwatchPositions] = useState(initialSwatchPositions);
  const [colorSliderPosition, setColorSliderPosition] = useState(initialSwatchPositions[0]);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const activeMap = availableWorkspaceMaps.find(map => map.id === online.state.board?.mapId)
    ?? { id: online.state.board?.mapId ?? '', title: online.state.board?.mapId ?? 'Карта не выбрана', replayMapName: '' };
  const visibleReplays = replays.filter(replay => !activeMap.replayMapName || replay.mapName === activeMap.replayMapName);
  const hasReplay = state.replayLoaded && state.playback.replayId !== null;
  const maxTime = Math.max(state.playback.maxTime, state.playback.minTime + 0.05);
  const progress = hasReplay
    ? Math.max(0, Math.min(100, (state.playback.time - state.playback.minTime) / (maxTime - state.playback.minTime) * 100))
    : 0;

  const swatchColors = swatchPositions.map(interpolateColor);

  const tankPlacementDefaults = useMemo<ManualTankPlacementDefaults>(() => ({
    label: markerLabel,
    visualKey: markerTankType,
    team: 'neutral',
    color: state.drawingColor,
  }), [markerLabel, markerTankType, state.drawingColor]);

  const mapSessionReplay = (replay: ReplaySessionItem, mapName: string): WorkspaceReplayRow => ({
    id: replay.replayId,
    replayId: replay.replayId,
    mapName,
    title: replay.title || replay.sourceFileName || replay.replayId,
    source: 'session',
    battleDuration: replay.battleDuration ?? null,
    importedAtUtc: replay.importedAtUtc ?? null,
  });

  const refreshCurrentSessionReplays = async (mapName: string) => {
    const items = await onLoadCurrentSessionReplays(mapName);
    setReplays(items.map((item) => mapSessionReplay(item, mapName)));
  };

  useEffect(() => {
    if (viewerReady && state.mapLoaded) void refreshCurrentSessionReplays(activeMap.replayMapName);
  }, [viewerReady, state.mapId, state.mapLoaded]);

  useEffect(() => {
    const replayId = state.replayId.trim();

    if (!state.replayLoaded || !replayId) {
      return;
    }

    setReplays((current) => {
      if (current.some((replay) => replay.replayId === replayId)) {
        return current;
      }

      return [{
        id: createId(),
        replayId,
        mapName: activeMap.replayMapName,
        title: `Replay ${new Date().toLocaleTimeString('ru-RU')}`,
        source: 'manual',
        battleDuration: null,
        importedAtUtc: null,
      }, ...current];
    });
  }, [activeMap.replayMapName, state.replayId, state.replayLoaded]);

  const updateSelectedTank = (patch: Partial<ManualTankModel>) => {
    if (selectedTank) {
      onManualTankChange({ ...selectedTank, ...patch });
    }
  };

  const updateSelectedTankPose = (patch: Partial<ManualTankModel['pose']>) => {
    if (selectedTank) {
      const pose = { ...selectedTank.pose, ...patch };
      if (selectedTank.aimTarget) {
        const yaw = Math.atan2(selectedTank.aimTarget.x - pose.x, selectedTank.aimTarget.z - pose.z) * 180 / Math.PI - pose.bodyYawDegrees;
        pose.turretYawDegrees = ((yaw + 180) % 360 + 360) % 360 - 180;
      }
      onManualTankChange({ ...selectedTank, pose });
    }
  };

  const importReplayFiles = async (files: FileList | null) => {
    const selectedFiles = Array.from(files ?? []);

    if (selectedFiles.length === 0) {
      return;
    }

    await onImportReplayFiles(selectedFiles);
    await refreshCurrentSessionReplays(activeMap.replayMapName);
  };

  const selectSwatch = (index: number) => {
    const position = swatchPositions[index] ?? 0;
    setSelectedSwatchIndex(index);
    setColorSliderPosition(position);
    onDrawingColorChange(interpolateColor(position));
  };

  const changeColorSlider = (position: number) => {
    setColorSliderPosition(position);
    setSwatchPositions((current) => current.map((value, index) => index === selectedSwatchIndex ? position : value));
    onDrawingColorChange(interpolateColor(position));
  };

  const workspaceClassName = [
    'workspace',
    leftCollapsed ? 'is-left-collapsed' : '',
    rightCollapsed ? 'is-right-collapsed' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="tbr-design">
      <div className="tbr-app-shell">
        <header className="app-header">
          <div className="header-side side-left">
            <button
              className={presentEnabled ? 'header-side-button presentation-button is-playing' : 'header-side-button presentation-button'}
              type="button"
              aria-label="Запустить презентацию"
              onClick={() => setPresentEnabled((current) => !current)}
            >
              <span className="playback-icon-slot" aria-hidden="true">
                {presentEnabled ? <PauseIcon /> : <PlayIcon />}
              </span>
              <span className="presentation-label">Презентация</span>
            </button>
          </div>

          <div className="header-center-wrap">
            <div className="header-center-panel">
              <div className="control-row">
                <button className="header-action rewind" disabled={!hasReplay} onClick={() => onSeekReplayBy(-30)}>-30</button>
                <button className="header-action rewind" disabled={!hasReplay} onClick={() => onSeekReplayBy(-10)}>-10</button>
                <button className="header-action rewind" disabled={!hasReplay} onClick={() => onSeekReplayBy(-5)}>-5</button>
                <button
                  className="header-action pause replay-playback-toggle"
                  type="button"
                  disabled={!hasReplay}
                  aria-label={state.playback.isPlaying ? 'Поставить реплей на паузу' : 'Запустить реплей'}
                  onClick={state.playback.isPlaying ? onPauseReplay : onPlayReplay}
                >
                  {state.playback.isPlaying ? <PauseIcon /> : <PlayIcon />}
                </button>
                <button className="header-action forward" disabled={!hasReplay} onClick={() => onSeekReplayBy(5)}>+5</button>
                <button className="header-action forward" disabled={!hasReplay} onClick={() => onSeekReplayBy(10)}>+10</button>
                <button className="header-action forward" disabled={!hasReplay} onClick={() => onSeekReplayBy(30)}>+30</button>
              </div>

              <div className="timeline-block">
                <div className="timeline-row">
                  <span className="timeline-edge left">0</span>
                  <div className="progress-wrap">
                    <div className="progress-rail">
                      <span className="progress-fill" style={{ width: `${progress}%` }} />
                      <span className="progress-handle" style={{ left: `${progress}%` }} />
                      <input
                        className="timeline-input"
                        type="range"
                        min={state.playback.minTime}
                        max={maxTime}
                        step={0.05}
                        value={state.playback.time}
                        disabled={!hasReplay}
                        aria-label="Позиция реплея"
                        onChange={(event) => onSeekReplayTo(event.target.valueAsNumber)}
                      />
                    </div>
                    <span className="current-time" style={{ left: `${progress}%` }}>{formatTimelineTime(state.playback.time)}</span>
                  </div>
                  <span className="timeline-edge right">{formatTimelineTime(state.playback.maxTime)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="header-side side-right">
            <button className="header-side-button map-config-button" disabled={online.user.role !== 'admin'} onClick={() => onModeChange('debugCalibration')}>Конфигуратор карты</button>
          </div>
        </header>

        <main className={workspaceClassName}>
          <button
            className="column-toggle column-toggle-left"
            type="button"
            aria-label={leftCollapsed ? 'Показать левую колонку' : 'Скрыть левую колонку'}
            aria-pressed={leftCollapsed}
            onClick={() => setLeftCollapsed((current) => !current)}
          >
            <ChevronLeftIcon />
          </button>

          <aside className="left-column side-column">
            <section className="panel tools-panel">
              <div className="tools-top">
                <div className="tools-header">
                  <span className="panel-label static">Инструменты</span>
                </div>

                <div className="controls-block">
                  <div className="color-row">
                    {swatchColors.map((color, index) => (
                      <button
                        key={index}
                        className={selectedSwatchIndex === index ? 'swatch selected' : 'swatch'}
                        type="button"
                        aria-label={`Быстрый цвет ${index + 1}`}
                        aria-pressed={selectedSwatchIndex === index}
                        style={{ '--swatch-color': color } as React.CSSProperties}
                        onClick={() => selectSwatch(index)}
                      />
                    ))}
                  </div>

                  <div className="slider-row">
                    <div className="slider-track">
                      <span className="slider-thumb" style={{ left: `${colorSliderPosition / 10}%` }} aria-hidden="true" />
                      <input
                        className="color-slider"
                        type="range"
                        min={0}
                        max={1000}
                        step={1}
                        value={colorSliderPosition}
                        aria-label="Выбор цвета"
                        onChange={(event) => changeColorSlider(event.target.valueAsNumber)}
                      />
                    </div>

                    <label className="pipette" aria-label="Выбрать произвольный цвет">
                      <PipetteIcon />
                      <input
                        type="color"
                        value={state.drawingColor}
                        hidden
                        onChange={(event) => onDrawingColorChange(event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <div className={online.canEdit && state.mapLoaded ? "tools-grid" : "tools-grid online-tools-readonly"} role="toolbar" aria-label="Инструменты">
                  <ToolSlot tool="select" selectedTool={state.selectedTool} label="Курсор" onSelect={onSelectedToolChange}><CursorIcon /></ToolSlot>
                  <ToolSlot tool="drawLine" selectedTool={state.selectedTool} label="Прямая линия" onSelect={onSelectedToolChange}><LineIcon /></ToolSlot>
                  <ToolSlot tool="draw" selectedTool={state.selectedTool} label="Кривая линия" onSelect={onSelectedToolChange}><CurveIcon /></ToolSlot>
                  <ToolSlot tool="tankPlacement" selectedTool={state.selectedTool} label="Танковые метки" onSelect={onSelectedToolChange}><MarkersIcon /></ToolSlot>
                  <ToolSlot tool="erase" selectedTool={state.selectedTool} label="Ластик" onSelect={onSelectedToolChange}><EraserIcon /></ToolSlot>
                  <ToolSlot tool="text" selectedTool={state.selectedTool} label="Текст" onSelect={onSelectedToolChange}><TextIcon /></ToolSlot>
                </div>
              </div>

              <div className="settings-area">
                <span className="panel-label static">Настройки инструмента</span>
                <div className="tool-settings-content" aria-live="polite">
                  <ToolSettings
                    state={state}
                    selectedTank={selectedTank}
                    markerLabel={markerLabel}
                    markerTankType={markerTankType}
                    onMarkerLabelChange={setMarkerLabel}
                    onMarkerTankTypeChange={setMarkerTankType}
                    onDrawingWidthChange={onDrawingWidthChange}
                    onDrawingLineStyleChange={onDrawingLineStyleChange}
                    onDrawingArrowModeChange={onDrawingArrowModeChange}
                    onSelectedToolChange={onSelectedToolChange}
                    onClearManualTanks={onClearManualTanks}
                    onDeleteSelectedManualTank={onDeleteSelectedManualTank}
                    onUpdateSelectedTank={updateSelectedTank}
                    onUpdateSelectedTankPose={updateSelectedTankPose}
                  />
                </div>
              </div>
            </section>

            <section className="panel replays-panel">
              <div className="replays-header split-mode">
                <div>
                  <span className="panel-label static">Реплеи</span>
                  <span className="tiny-meta">{visibleReplays.length} файлов</span>
                </div>
                <button className="upload-button" onClick={() => uploadInputRef.current?.click()}>Загрузить</button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  multiple
                  accept=".tbreplay"
                  hidden
                  onChange={(event) => {
                    void importReplayFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
              </div>

              <div className="replays-content split-toolbar-list">
                {visibleReplays.length === 0 ? (
                  <div className="replay-empty">Для этой карты реплеев пока нет</div>
                ) : (
                  <ul className="replay-list split-replays">
                    {visibleReplays.map((replay) => (
                      <li
                        key={replay.id}
                        className={state.replayId === replay.replayId ? 'selected' : ''}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          onReplayIdChange(replay.replayId);
                          void onLoadReplayById(replay.replayId);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onReplayIdChange(replay.replayId);
                            void onLoadReplayById(replay.replayId);
                          }
                        }}
                      >
                        <span><strong>{replay.title}</strong><small>{activeMap.title}</small></span>
                        <em>{replay.battleDuration === null ? '—' : formatDuration(replay.battleDuration)}</em>
                      </li>
                    ))}
                  </ul>
                )}

              </div>
            </section>
          </aside>

          <section className="center-stage">
            <div className="map-panel">
              <span className="panel-label">Карта</span>
              <div className="map-export-controls">
                <button type="button" disabled={!viewerReady || !state.mapLoaded || exporting}
                  title="Сохранить карту сверху с рисунками и ручными танковыми метками, 2048 × 2048"
                  onClick={() => void exportPng()}>{exporting ? 'Создаю PNG…' : 'Скрин карты (PNG)'}</button>
                {exportStatus && <span role="status">{exportStatus}</span>}
              </div>
              <div className="viewer-slot">
                <ViewerHost
                  mode={state.mode}
                  selectedTool={state.selectedTool}
                  drawingColor={state.drawingColor}
                  drawingWidth={state.drawingWidth}
                  drawingLineStyle={state.drawingLineStyle}
                  drawingArrowMode={state.drawingArrowMode}
                  manualTanks={state.manualTanks}
                  selectedManualTankId={state.selectedManualTankId}
                  tankPlacementDefaults={tankPlacementDefaults}
                  onTankCreated={onTankCreated}
                  onTankChanged={onTankChanged}
                  onTankSelected={onTankSelected}
                  onReplayPlaybackChanged={onReplayPlaybackChanged}
                  onEngineReady={(engine) => {
                    setViewerReady(engine !== null);
                    onEngineReady(engine);
                  }}
                />
                {state.replayLoaded && <ReplayBattleOverlay data={state.replayTeamHealth} />}
              </div>
            </div>
          </section>

          <button
            className="column-toggle column-toggle-right"
            type="button"
            aria-label={rightCollapsed ? 'Показать правую колонку' : 'Скрыть правую колонку'}
            aria-pressed={rightCollapsed}
            onClick={() => setRightCollapsed((current) => !current)}
          >
            <ChevronRightIcon />
          </button>

          <aside className="right-column side-column">
            <OnlinePanel />
            <OnlineMapControls />
          </aside>
        </main>
      </div>


    </div>
  );
}

function ToolSlot({
  tool,
  selectedTool,
  label,
  onSelect,
  children,
}: {
  tool: ViewerTool;
  selectedTool: ViewerTool;
  label: string;
  onSelect: (tool: ViewerTool) => void;
  children: React.ReactNode;
}) {
  const online = useOnline();
  const active = selectedTool === tool || (tool === 'tankPlacement' && selectedTool === 'tankAim');

  return (
    <button className={active ? 'tool-slot is-active' : 'tool-slot'} type="button" disabled={tool !== 'select' && !online.canEdit} aria-label={label} aria-pressed={active} onClick={() => onSelect(tool)}>
      {children}
    </button>
  );
}

function ToolSettings({
  state,
  selectedTank,
  markerLabel,
  markerTankType,
  onMarkerLabelChange,
  onMarkerTankTypeChange,
  onDrawingWidthChange,
  onDrawingLineStyleChange,
  onDrawingArrowModeChange,
  onClearManualTanks,
  onDeleteSelectedManualTank,
  onUpdateSelectedTank,
  onUpdateSelectedTankPose,
  onSelectedToolChange,
}: {
  state: AppState;
  selectedTank: ManualTankModel | null;
  markerLabel: string;
  markerTankType: TankVisualKey;
  onMarkerLabelChange: (value: string) => void;
  onMarkerTankTypeChange: (value: TankVisualKey) => void;
  onDrawingWidthChange: (width: number) => void;
  onDrawingLineStyleChange: (lineStyle: DrawingLineStyle) => void;
  onDrawingArrowModeChange: (arrowMode: DrawingArrowMode) => void;
  onClearManualTanks: () => void;
  onDeleteSelectedManualTank: () => void;
  onUpdateSelectedTank: (patch: Partial<ManualTankModel>) => void;
  onSelectedToolChange: (tool: ViewerTool) => void;
  onUpdateSelectedTankPose: (patch: Partial<ManualTankModel['pose']>) => void;
}) {
  const { canEdit } = useOnline();
  if ((state.selectedTool === 'drawLine' || state.selectedTool === 'draw')) {
    const progress = (Math.max(1, Math.min(10, state.drawingWidth)) - 1) / 9 * 100;

    return (
      <div className="stroke-settings">
        <section className="stroke-setting-section">
          <div className="stroke-setting-header"><span>Размер</span><span className="stroke-setting-value">{state.drawingWidth}</span></div>
          <div className="stroke-size-control">
            <input
              className="stroke-size-slider"
              type="range"
              min={1}
              max={10}
              step={1}
              value={Math.max(1, Math.min(10, state.drawingWidth))}
              aria-label="Размер линии"
              style={{ '--stroke-progress': `${progress}%` } as React.CSSProperties}
              onChange={(event) => onDrawingWidthChange(event.target.valueAsNumber)}
            />
            <div className="stroke-size-ticks" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <i key={index} />)}</div>
          </div>
        </section>

        <section className="stroke-setting-section">
          <div className="stroke-setting-header"><span>Тип линии</span><span className="stroke-setting-value">{state.drawingLineStyle === 'solid' ? 'Сплошная' : 'Пунктир'}</span></div>
          <div className="stroke-option-grid" role="group" aria-label="Тип линии">
            <StrokeOption active={state.drawingLineStyle === 'solid'} kind="solid" onClick={() => onDrawingLineStyleChange('solid')} />
            <StrokeOption active={state.drawingLineStyle === 'dashed'} kind="dashed" onClick={() => onDrawingLineStyleChange('dashed')} />
          </div>
        </section>

        <section className="stroke-setting-section">
          <div className="stroke-setting-header"><span>Наконечник</span><span className="stroke-setting-value">{state.drawingArrowMode === 'end' ? 'Стрелка' : 'Пустой'}</span></div>
          <div className="stroke-option-grid" role="group" aria-label="Наконечник линии">
            <StrokeOption active={state.drawingArrowMode !== 'end'} kind="none" onClick={() => onDrawingArrowModeChange('none')} />
            <StrokeOption active={state.drawingArrowMode === 'end'} kind="arrow" onClick={() => onDrawingArrowModeChange('end')} />
          </div>
        </section>
      </div>
    );
  }

  if (state.selectedTool === 'tankPlacement' || (state.selectedTool === 'tankAim' && !selectedTank)) {
    return (
      <fieldset disabled={!canEdit} className="marker-settings tank-settings-fieldset">
        <input className="marker-label-input" type="text" maxLength={80} value={markerLabel} aria-label="Подпись танковой метки" onChange={(event) => onMarkerLabelChange(event.target.value)} />
        <div className="marker-type-grid" role="group" aria-label="Тип танковой метки">
          {tankTypeOptions.map((option) => (
            <button
              key={option.value}
              className={markerTankType === option.value ? 'marker-type-button is-active' : 'marker-type-button'}
              type="button"
              title={option.label}
              aria-pressed={markerTankType === option.value}
              onClick={() => onMarkerTankTypeChange(option.value)}
            ><TankMarkerIcon type={option.value} /></button>
          ))}
        </div>
        <button className="clear-marker-icons-button" type="button" onClick={() => onSelectedToolChange('tankAim')}>Указать зацел</button>
        <p className="tiny-meta">Для зацела выберите танк, затем точку на карте.</p>
        <button className="clear-marker-icons-button" type="button" onClick={onClearManualTanks}>Очистить все иконки</button>
      </fieldset>
    );
  }

  if ((state.selectedTool === 'select' || state.selectedTool === 'tankAim') && selectedTank) {
    return (
      <fieldset disabled={!canEdit} className="marker-settings selected-tank-settings tank-settings-fieldset">
        <input key={selectedTank.id + selectedTank.label} className="marker-label-input" defaultValue={selectedTank.label} maxLength={80} aria-label="Название танка" onBlur={event => { if (event.target.value !== selectedTank.label) onUpdateSelectedTank({ label: event.target.value }); }} />
        <AngleControl label="Корпус" value={selectedTank.pose.bodyYawDegrees} onChange={(value) => onUpdateSelectedTankPose({ bodyYawDegrees: value })} />
        <AngleControl label="Башня" value={selectedTank.pose.turretYawDegrees} onChange={(value) => onUpdateSelectedTank({ pose: { ...selectedTank.pose, turretYawDegrees: value }, aimTarget: null })} />
        <button className="clear-marker-icons-button" type="button" aria-pressed={state.selectedTool === 'tankAim'} onClick={() => onSelectedToolChange(state.selectedTool === 'tankAim' ? 'select' : 'tankAim')}>
          {state.selectedTool === 'tankAim' ? 'Завершить зацел' : 'Указать зацел'}
        </button>
        {selectedTank.aimTarget && <button className="clear-marker-icons-button" type="button" onClick={() => onUpdateSelectedTank({ aimTarget: null })}>Убрать зацел</button>}
        <p className="tiny-meta">Клик по карте задаёт точку зацела. Точку можно перетаскивать.</p>
        <button className="clear-marker-icons-button danger" type="button" onClick={onDeleteSelectedManualTank}>Удалить выбранный танк</button>
      </fieldset>
    );
  }

  return <div className="tool-settings-empty" />;
}

function StrokeOption({ active, kind, onClick }: { active: boolean; kind: 'solid' | 'dashed' | 'none' | 'arrow'; onClick: () => void }) {
  return (
    <button className={active ? 'stroke-option-button is-active' : 'stroke-option-button'} type="button" aria-pressed={active} onClick={onClick}>
      <svg viewBox="0 0 100 50" aria-hidden="true">
        {kind === 'arrow' && <><line x1="75" y1="10" x2="95" y2="25" /><line x1="75" y1="40" x2="95" y2="25" /></>}
        <line x1="5" y1="25" x2="95" y2="25" strokeDasharray={kind === 'dashed' ? '7 14' : undefined} />
      </svg>
    </button>
  );
}

function AngleControl({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft !== value) onChange(draft); };
  return <label className="angle-control">
    <span>{label}<b>{draft.toFixed(0)}°</b></span>
    <input aria-label={label} type="range" min={-180} max={180} value={draft}
      onChange={event => setDraft(event.target.valueAsNumber)} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
  </label>;
}

function interpolateColor(position: number): string {
  const clamped = Math.max(0, Math.min(1000, position));

  for (let index = 0; index < colorSliderStops.length - 1; index += 1) {
    const current = colorSliderStops[index];
    const next = colorSliderStops[index + 1];

    if (clamped >= current.position && clamped <= next.position) {
      const factor = (clamped - current.position) / (next.position - current.position);
      const start = hexToRgb(current.color);
      const end = hexToRgb(next.color);
      return rgbToHex({
        r: start.r + (end.r - start.r) * factor,
        g: start.g + (end.g - start.g) * factor,
        b: start.b + (end.b - start.b) * factor,
      });
    }
  }

  return colorSliderStops[colorSliderStops.length - 1].color;
}

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }) {
  const parts = [r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'));
  return `#${parts.join('')}`;
}

function formatDuration(time: number) {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time - minutes * 60);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatTimelineTime(time: number) {
  if (!Number.isFinite(time)) {
    return '00:00:00.000';
  }

  const totalMilliseconds = Math.max(0, Math.round(time * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor(totalMilliseconds % 3_600_000 / 60_000);
  const seconds = Math.floor(totalMilliseconds % 60_000 / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return [hours, minutes, seconds].map((value) => value.toString().padStart(2, '0')).join(':') + `.${milliseconds.toString().padStart(3, '0')}`;
}

function PlayIcon() { return <svg className="playback-svg" viewBox="0 0 20 20"><path className="rounded-play-shape" d="M7.1 5.8c0-1.25 1.38-2.01 2.43-1.34l5.08 3.23c1.21.77 1.21 2.55 0 3.32l-5.08 3.23c-1.05.67-2.43-.09-2.43-1.34Z" /></svg>; }
function PauseIcon() { return <svg className="playback-svg" viewBox="0 0 20 20"><rect className="rounded-pause-shape" x="5.6" y="4.4" width="3.4" height="11.2" rx="1.7" /><rect className="rounded-pause-shape" x="11" y="4.4" width="3.4" height="11.2" rx="1.7" /></svg>; }
function ChevronLeftIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true" className="toolbar-svg"><path d="M12.8 4.5 7.2 10l5.6 5.5" /></svg>; }
function ChevronRightIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true" className="toolbar-svg"><path d="M7.2 4.5 12.8 10l-5.6 5.5" /></svg>; }
function PipetteIcon() { return <svg className="pipette-svg uploaded-pipette-svg" viewBox="0 0 464.736 464.736" aria-hidden="true"><g fill="currentColor"><path d="M446.598 18.143c-24.183-24.184-63.393-24.191-87.592-.008l-16.717 16.717c-8.98-8.979-23.525-8.979-32.504 0-8.981 8.972-8.981 23.533 0 32.505l5.416 5.419L71.912 316.068c-4.982 4.982-7.919 11.646-8.235 18.684l-2.679 60.094c-.104 2.633.883 5.185 2.739 7.048 1.751 1.759 4.145 2.738 6.63 2.738l57.136-2.52c9.203-.412 17.944-4.259 24.469-10.776L392.87 150.445l4.506 4.505c8.98 8.977 23.526 8.977 32.505 0 8.98-8.973 8.98-23.534 0-32.505l16.716-16.718c24.185-24.183 24.185-63.393.001-87.584Z" /><path d="M64.5 423.872C28.883 423.872 0 433.017 0 444.307c0 11.284 28.883 20.428 64.5 20.428s64.486-9.143 64.486-20.428c0-11.291-28.869-20.435-64.486-20.435Z" /></g></svg>; }
function CursorIcon() { return <svg viewBox="0 0 24 24" fill="none" className="tool-svg tool-svg--stroke"><path d="m4 4 7.07 17 2.51-7.39L21 11.07Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function LineIcon() { return <svg viewBox="0 0 640 512" className="tool-svg tool-svg--fill"><path fill="currentColor" d="M0 256c0-13.3 10.7-24 24-24h592c13.3 0 24 10.7 24 24s-10.7 24-24 24H24c-13.3 0-24-10.7-24-24Z" /></svg>; }
function CurveIcon() { return <svg viewBox="0 0 512 512" className="tool-svg tool-svg--fill"><path fill="currentColor" d="M183.3 21.4C198.3 7.7 218 0 238.4 0h1c44.5 0 80.6 36.1 80.6 80.6 0 21.4-8.5 41.9-23.6 57L89.5 344.4c-6.1 6.1-9.5 14.4-9.5 23 0 18 14.6 32.6 32.6 32.6 8.6 0 16.9-3.4 23-9.5L374.5 151.6c15.1-15.1 35.6-23.6 57-23.6 44.5 0 80.6 36.1 80.6 80.6 0 21.4-8.5 41.9-23.6 57L384.2 369.8c-10.4 10.3-16.2 24.4-16.2 39 0 30.5 24.7 55.2 55.2 55.2h4.4c5.6 0 11.2-.9 16.6-2.7l36.2-12.1c12.6-4.2 26.2 2.6 30.4 15.2s-2.6 26.2-15.2 30.4l-36.2 12.1c-10.2 3.4-21 5.2-31.8 5.2h-4.4c-57 0-103.2-46.2-103.2-103.2 0-27.4 10.9-53.6 30.2-73L454.5 231.6c6.1-6.1 9.5-14.4 9.5-23 0-18-14.6-32.6-32.6-32.6-8.6 0-16.9 3.4-23 9.5L169.5 424.4c-15.1 15.1-35.6 23.6-57 23.6-44.5 0-80.6-36.1-80.6-80.6 0-21.4 8.5-41.9 23.6-57L262.5 103.6c6.1-6.1 9.5-14.4 9.5-23 0-18-14.6-32.6-32.6-32.6h-1c-8.4 0-16.5 3.2-22.7 8.8L40.2 217.7c-9.8 9-25 8.3-33.9-1.5s-8.3-25 1.5-33.9Z" /></svg>; }
function MarkersIcon() { return <svg viewBox="0 0 32 32" fill="none" className="tool-svg tool-svg--fill tool-svg--markers"><g fill="currentColor"><g transform="translate(8.2 8) rotate(42)"><rect x="-4.65" y="-4.7" width="2.55" height="9.4" rx=".35" /><rect x="-1.25" y="-4.7" width="2.55" height="9.4" rx=".35" /><rect x="2.15" y="-4.7" width="2.55" height="9.4" rx=".35" /></g><g transform="translate(21.4 8.7) rotate(42)"><rect x="-4.8" y="-5" width="4.3" height="10" rx=".35" /><rect x=".5" y="-5" width="4.3" height="10" rx=".35" /></g><path d="m9.2 15.2 6 6.9-6 6.9-6-6.9Z" /><path d="M17 18h12.1l-6.05 10.7Z" /></g></svg>; }
function EraserIcon() { return <svg viewBox="0 0 576 512" className="tool-svg tool-svg--fill"><path fill="currentColor" d="M0 304c0 15.4 6.1 30.1 17 41l116.3 116.3c12 12 28.3 18.7 45.3 18.7H512c17.7 0 32-14.3 32-32s-14.3-32-32-32H392l20-20L148 132C104.3 175.7 60.7 219.3 17 263c-10.9 10.9-17 25.6-17 41Zm193.3-126.7L412 396l115-115c10.9-10.9 17-25.6 17-41s-6.1-30.1-17-41L345 17C334.1 6.1 319.4 0 304 0s-30.1 6.1-41 17L148 132Z" /></svg>; }
function TextIcon() { return <svg viewBox="0 0 384 512" className="tool-svg tool-svg--fill tool-svg--text"><path fill="currentColor" d="M64 96v32c0 17.7-14.3 32-32 32S0 145.7 0 128V72c0-22.1 17.9-40 40-40h304c22.1 0 40 17.9 40 40v56c0 17.7-14.3 32-32 32s-32-14.3-32-32V96h-96v320h48c17.7 0 32 14.3 32 32s-14.3 32-32 32H112c-17.7 0-32-14.3-32-32s14.3-32 32-32h48V96Z" /></svg>; }
function TankMarkerIcon({ type }: { type: TankVisualKey }) {
  if (type === 'heavy') return <svg className="marker-option-icon" viewBox="0 0 24 24"><g fill="currentColor" transform="translate(12 12) rotate(42)"><rect x="-5.15" y="-5.2" width="2.7" height="10.4" rx=".35" /><rect x="-1.35" y="-5.2" width="2.7" height="10.4" rx=".35" /><rect x="2.45" y="-5.2" width="2.7" height="10.4" rx=".35" /></g></svg>;
  if (type === 'medium') return <svg className="marker-option-icon" viewBox="0 0 24 24"><g fill="currentColor" transform="translate(12 12) rotate(42)"><rect x="-4.8" y="-5" width="4.3" height="10" rx=".35" /><rect x=".5" y="-5" width="4.3" height="10" rx=".35" /></g></svg>;
  if (type === 'light') return <svg className="marker-option-icon" viewBox="0 0 24 24"><path fill="currentColor" d="m12 3.1 6.4 8.9-6.4 8.9L5.6 12Z" /></svg>;
  return <svg className="marker-option-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M4.2 7.1h15.6L12 20.9Z" /></svg>;
}
