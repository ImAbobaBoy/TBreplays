import type { MapCalibration } from '../domain/MapCalibration';
import type { ManualTankModel } from '../domain/TankModels';
import type { AppMode } from './AppMode';

export type ViewerTool =
  | 'select'
  | 'draw'
  | 'erase'
  | 'marker'
  | 'tankPlacement';

export type AppState = {
  mode: AppMode;

  mapId: string;
  replayId: string;

  status: string;

  selectedTool: ViewerTool;
  drawingColor: string;

  manualTanks: ManualTankModel[];
  selectedManualTankId: string | null;

  mapLoaded: boolean;
  replayLoaded: boolean;

  calibration: MapCalibration | null;

  playback: {
    time: number;
    minTime: number;
    maxTime: number;
    isPlaying: boolean;
    speed: number;
  };
};

export const createInitialAppState = (): AppState => ({
  mode: 'workspace',

  mapId: '',
  replayId: '',

  status: 'Готово',
  
  selectedTool: 'select',
  drawingColor: '#ffff00',

  manualTanks: [],
  selectedManualTankId: null,

  mapLoaded: false,
  replayLoaded: false,

  calibration: null,

  playback: {
    time: 0,
    minTime: 0,
    maxTime: 0,
    isPlaying: false,
    speed: 1,
  },
});