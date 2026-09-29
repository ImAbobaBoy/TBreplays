import type { MapCalibration } from '../domain/MapCalibration';
import type {
  ReplayPlaybackState,
  ReplayTeamHealthState,
} from '../domain/ReplayModels';
import type { ManualTankModel } from '../domain/TankModels';
import type { AppMode } from './AppMode';

export type ViewerTool =
  | 'select'
  | 'drawLine'
  | 'draw'
  | 'erase'
  | 'marker'
  | 'text'
  | 'tankPlacement'
  | 'tankAim';

export type DrawingLineStyle = 'solid' | 'dashed';

export type DrawingArrowMode = 'none' | 'dot' | 'end';

export type AppState = {
  mode: AppMode;

  mapId: string;
  replayId: string;

  status: string;

  selectedTool: ViewerTool;
  drawingColor: string;
  drawingWidth: number;
  drawingLineStyle: DrawingLineStyle;
  drawingArrowMode: DrawingArrowMode;

  manualTanks: ManualTankModel[];
  selectedManualTankId: string | null;

  mapLoaded: boolean;
  replayLoaded: boolean;

  calibration: MapCalibration | null;

  playback: ReplayPlaybackState;
  replayTeamHealth: ReplayTeamHealthState | null;
};

export const createInitialAppState = (): AppState => ({
  mode: 'workspace',

  mapId: '18_canal_cn-e742cb29',
  replayId: '',

  status: 'Готово',
  
  selectedTool: 'select',
  drawingColor: '#38bdf8',
  drawingWidth: 4,
  drawingLineStyle: 'solid',
  drawingArrowMode: 'none',

  manualTanks: [],
  selectedManualTankId: null,

  mapLoaded: false,
  replayLoaded: false,

  calibration: null,

  playback: {
    replayId: null,
    time: 0,
    minTime: 0,
    maxTime: 0,
    isPlaying: false,
    speed: 1,
    revision: 0,
  },
  replayTeamHealth: null,
});