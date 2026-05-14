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
    <section className="panel-card calibration-card">
      <div>
        <div className="panel-kicker">DEBUG MODE</div>
        <div className="panel-title">Калибровка карты</div>
        <div className="panel-caption">
          Настройка размера, высоты, ориентации terrain/replay и surface bindings. Replay controls остаются наверху, чтобы сверять траектории прямо во время подгонки.
        </div>
      </div>

      <div className="load-grid load-grid--calibration">
        <label className="field field--compact">
          <span>Map ID</span>
          <input
            value={state.mapId}
            onChange={(event) => onMapIdChange(event.target.value)}
            placeholder="18_canal_cn-..."
          />
        </label>

        <button className="action-button action-button--primary" onClick={onLoadMap}>
          <span className="action-icon">↥</span>
          <span>Загрузить карту</span>
        </button>

        <label className="field field--compact">
          <span>Debug Replay ID</span>
          <input
            value={state.replayId}
            onChange={(event) => onReplayIdChange(event.target.value)}
            placeholder="replay id для сверки"
          />
        </label>
      </div>

      <div className="warning-note">
        Инженерный режим меняет черновик map_calibration.json. Для просмотра результата нажимай «Применить черновик к карте», для записи на backend — «Сохранить map_calibration.json».
      </div>

      <CalibrationDebugEditor
        calibration={state.calibration}
        onChange={onCalibrationChange}
        onPreview={onPreviewCalibration}
        onSave={onSaveCalibration}
      />
    </section>
  );
}
