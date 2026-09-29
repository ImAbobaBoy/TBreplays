import { useEffect, useRef } from 'react';

import type { AppMode } from '../app/AppMode';
import type {
  DrawingArrowMode,
  DrawingLineStyle,
  ViewerTool,
} from '../app/AppState';
import type { ReplayPlaybackState } from '../domain/ReplayModels';
import type {
  ManualTankModel,
  ManualTankPlacementDefaults,
} from '../domain/TankModels';
import { ViewerEngine } from './ViewerEngine';

type ViewerHostProps = {
  mode: AppMode;
  selectedTool: ViewerTool;
  drawingColor: string;
  drawingWidth: number;
  drawingLineStyle: DrawingLineStyle;
  drawingArrowMode: DrawingArrowMode;
  manualTanks: ManualTankModel[];
  selectedManualTankId: string | null;
  tankPlacementDefaults?: ManualTankPlacementDefaults;
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
  drawingWidth,
  drawingLineStyle,
  drawingArrowMode,
  manualTanks,
  selectedManualTankId,
  tankPlacementDefaults,
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
    engine.setDrawingWidth(drawingWidth);
    engine.setDrawingLineStyle(drawingLineStyle);
    engine.setDrawingArrowMode(drawingArrowMode);
    engine.setManualTanks(manualTanks);
    engine.setSelectedManualTankId(selectedManualTankId);

    if (tankPlacementDefaults) {
      engine.setTankPlacementDefaults(tankPlacementDefaults);
    }

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
    engineRef.current?.setDrawingWidth(drawingWidth);
  }, [drawingWidth]);

  useEffect(() => {
    engineRef.current?.setDrawingLineStyle(drawingLineStyle);
  }, [drawingLineStyle]);

  useEffect(() => {
    engineRef.current?.setDrawingArrowMode(drawingArrowMode);
  }, [drawingArrowMode]);

  useEffect(() => {
    engineRef.current?.setManualTanks(manualTanks);
  }, [manualTanks]);

  useEffect(() => {
    engineRef.current?.setSelectedManualTankId(selectedManualTankId);
  }, [selectedManualTankId]);

  useEffect(() => {
    if (!tankPlacementDefaults) {
      return;
    }

    engineRef.current?.setTankPlacementDefaults(tankPlacementDefaults);
  }, [tankPlacementDefaults]);


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