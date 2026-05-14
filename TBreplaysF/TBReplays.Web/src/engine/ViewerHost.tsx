import { useEffect, useRef } from 'react';

import type { AppMode } from '../app/AppMode';
import type { ViewerTool } from '../app/AppState';
import type { ReplayPlaybackState } from '../domain/ReplayModels';
import type { ManualTankModel } from '../domain/TankModels';
import { ViewerEngine } from './ViewerEngine';

type ViewerHostProps = {
  mode: AppMode;
  selectedTool: ViewerTool;
  drawingColor: string;
  manualTanks: ManualTankModel[];
  selectedManualTankId: string | null;
  onTankCreated: (tank: ManualTankModel) => void;
  onTankChanged: (tank: ManualTankModel) => void;
  onTankSelected: (tankId: string | null) => void;
  onReplayPlaybackChanged: (playback: ReplayPlaybackState) => void;
  onEngineReady: (engine: ViewerEngine | null) => void;
};

export function ViewerHost({
  mode,
  selectedTool,
  drawingColor,
  manualTanks,
  selectedManualTankId,
  onTankCreated,
  onTankChanged,
  onTankSelected,
  onReplayPlaybackChanged,
  onEngineReady,
}: ViewerHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ViewerEngine | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const engine = new ViewerEngine(containerRef.current);
    engineRef.current = engine;

    engine.setMode(mode);
    engine.setTool(selectedTool);
    engine.setDrawingColor(drawingColor);
    engine.setManualTanks(manualTanks);
    engine.setSelectedManualTankId(selectedManualTankId);
    engine.setTankLayerHandlers({
      onTankCreated,
      onTankChanged,
      onTankSelected,
    });
    engine.setReplayPlaybackChangedHandler(onReplayPlaybackChanged);

    onEngineReady(engine);

    return () => {
      onEngineReady(null);
      engine.setReplayPlaybackChangedHandler(null);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    engineRef.current?.setTool(selectedTool);
  }, [selectedTool]);

  useEffect(() => {
    engineRef.current?.setDrawingColor(drawingColor);
  }, [drawingColor]);

  useEffect(() => {
    engineRef.current?.setManualTanks(manualTanks);
  }, [manualTanks]);

  useEffect(() => {
    engineRef.current?.setSelectedManualTankId(selectedManualTankId);
  }, [selectedManualTankId]);

  useEffect(() => {
    engineRef.current?.setTankLayerHandlers({
      onTankCreated,
      onTankChanged,
      onTankSelected,
    });
  }, [onTankCreated, onTankChanged, onTankSelected]);

  useEffect(() => {
    engineRef.current?.setReplayPlaybackChangedHandler(onReplayPlaybackChanged);
  }, [onReplayPlaybackChanged]);

  return (
    <div
      className="viewer-host"
      ref={containerRef}
    />
  );
}