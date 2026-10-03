import type { DrawingStrokeModel } from './DrawingModels';
import type { ManualTankModel } from './TankModels';

export type WorkspaceMapDefinition = {
  id: string;
  title: string;
  subtitle: string;
  replayMapName: string;
  replayMapNames: string[];
};

export type StrategySnapshot = {
  manualTanks: ManualTankModel[];
  selectedManualTankId: string | null;
  strokes: DrawingStrokeModel[];
};

export type StrategySlideModel = {
  id: string;
  mapId: string;
  title: string;
  snapshot: StrategySnapshot;
};


export const createEmptyStrategySnapshot = (): StrategySnapshot => ({
  manualTanks: [],
  selectedManualTankId: null,
  strokes: [],
});
