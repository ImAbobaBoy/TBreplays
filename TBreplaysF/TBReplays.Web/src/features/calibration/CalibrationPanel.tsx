import type { AppState } from '../../app/AppState';
import type { MapCalibration } from '../../domain/MapCalibration';
import { CalibrationDebugEditor } from './CalibrationDebugEditor';

type CalibrationPanelProps = {
  state: AppState;
  onMapIdChange: (mapId: string) => void;
  onReplayIdChange: (replayId: string) => void;
  onLoadMap: () => void;
  onCalibrationChange: (calibration: MapCalibration) => void;
  onPreviewCalibration: () => void;
  onSaveCalibration: () => void;
};

export function CalibrationPanel({
  state,
  onMapIdChange,
  onReplayIdChange,
  onLoadMap,
  onCalibrationChange,
  onPreviewCalibration,
  onSaveCalibration,
}: CalibrationPanelProps) {
  return (
    <section className="panel-card">
      <div className="panel-title">Debug / калибровка</div>

      <label className="field">
        <span>Map ID</span>
        <input
          value={state.mapId}
          onChange={(event) => onMapIdChange(event.target.value)}
          placeholder="18_canal_cn-..."
        />
      </label>

      <label className="field">
        <span>Debug Replay ID</span>
        <input
          value={state.replayId}
          onChange={(event) => onReplayIdChange(event.target.value)}
          placeholder="canal-debug-..."
        />
      </label>

      <div className="button-row">
        <button onClick={onLoadMap}>Загрузить карту</button>
        <button disabled>Загрузить debug replay</button>
      </div>

      <div className="panel-subtitle">Калибровка карты</div>

      <CalibrationDebugEditor
        calibration={state.calibration}
        onChange={onCalibrationChange}
        onPreview={onPreviewCalibration}
        onSave={onSaveCalibration}
      />

      <div className="hint">
        Это инженерный режим. Поля ниже редактируют черновик map_calibration.json,
        а кнопка «Применить черновик к карте» перестраивает viewer.
      </div>
    </section>
  );
}