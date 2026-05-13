import { useMemo, useRef, useState } from 'react';

import type { AppMode } from './AppMode';
import { createInitialAppState } from './AppState';
import type { ViewerTool } from './AppState';
import type { ManualTankModel } from '../domain/TankModels';

import { ViewerHost } from '../engine/ViewerHost';
import { WorkspacePanel } from '../features/workspace/WorkspacePanel';
import { CalibrationPanel } from '../features/calibration/CalibrationPanel';
import type { MapCalibration } from '../domain/MapCalibration';
import type { ViewerEngine } from '../engine/ViewerEngine';

export function App() {
  const [state, setState] = useState(createInitialAppState);
  const viewerEngineRef = useRef<ViewerEngine | null>(null);

  const title = useMemo(() => {
    return state.mode === 'workspace'
      ? 'Рабочая поверхность'
      : 'Debug / калибровка';
  }, [state.mode]);

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

        setState((current) => ({
        ...current,
        calibration,
        manualTanks: [],
        selectedManualTankId: null,
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
        <div className="brand">
          <div className="brand-title">TB Replay Workbench</div>
          <div className="brand-subtitle">{title}</div>
        </div>

        <div className="mode-switch">
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
      </header>

      <main className="main-layout">
        <aside className="left-panel">
          {state.mode === 'workspace' ? (
            <WorkspacePanel
              state={state}
              onMapIdChange={setMapId}
              onReplayIdChange={setReplayId}
              onLoadMap={loadMap}
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
          <ViewerHost
            mode={state.mode}
            selectedTool={state.selectedTool}
            drawingColor={state.drawingColor}
            manualTanks={state.manualTanks}
            selectedManualTankId={state.selectedManualTankId}
            onTankCreated={addManualTank}
            onTankChanged={updateManualTank}
            onTankSelected={selectManualTank}
            onEngineReady={(engine) => {
              viewerEngineRef.current = engine;
            }}
          />
        </section>

        <aside className="right-panel">
          <section className="panel-card">
            <div className="panel-title">Состояние</div>

            <div className="kv">
                <span>Replay ID</span>
                <strong>{state.replayId || '—'}</strong>
            </div>

            <div className="kv">
                <span>Статус</span>
                <strong>{state.status}</strong>
            </div>

            <div className="kv">
              <span>Map ID</span>
              <strong>{state.mapId || '—'}</strong>
            </div>

            <div className="kv">
              <span>Replay ID</span>
              <strong>{state.replayId || '—'}</strong>
            </div>

            <div className="hint">
              Сейчас это только shell. Следующим шагом переносим сюда загрузку карты,
              текстур, объектов, реплея, HP и башни из legacy-кода.
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}