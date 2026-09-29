import type { MapCalibration } from '../../domain/MapCalibration';

type CalibrationDraftEditorProps = {
  calibration: MapCalibration | null;
  onChange: (calibration: MapCalibration) => void;
  onPreview: () => void;
  onSave: () => void;
};

export function CalibrationDraftEditor({
  calibration,
  onChange,
  onPreview,
  onSave,
}: CalibrationDraftEditorProps) {
  if (!calibration) {
    return (
      <div className="hint">
        Загрузи карту, и здесь появятся значения из map_calibration.json.
      </div>
    );
  }

  const changeHeightScale = (value: number) => {
    if (!Number.isFinite(value)) {
      return;
    }

    onChange({
      ...calibration,
      height: {
        ...calibration.height,
        scale: value,
        source: 'manual-debug-ui',
      },
    });
  };

  const changeHeightOffset = (value: number) => {
    if (!Number.isFinite(value)) {
      return;
    }

    onChange({
      ...calibration,
      height: {
        ...calibration.height,
        offset: value,
        source: 'manual-debug-ui',
      },
    });
  };

  const changeObjectHeightOffset = (value: number) => {
    if (!Number.isFinite(value)) {
      return;
    }

    onChange({
      ...calibration,
      objects: {
        ...calibration.objects,
        heightOffset: value,
      },
    });
  };

  const changeTextureRotation = (value: number) => {
    if (!Number.isFinite(value)) {
      return;
    }

    onChange({
      ...calibration,
      texture: {
        ...calibration.texture,
        rotationDegrees: value,
      },
    });
  };

  const changeTextureFlipU = (value: boolean) => {
    onChange({
      ...calibration,
      texture: {
        ...calibration.texture,
        flipU: value,
      },
    });
  };

  const changeTextureFlipV = (value: boolean) => {
    onChange({
      ...calibration,
      texture: {
        ...calibration.texture,
        flipV: value,
      },
    });
  };

  const copyCalibrationJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(calibration, null, 2));
  };

  return (
    <>
      <div className="kv">
        <span>mapKey</span>
        <strong>{calibration.mapKey}</strong>
      </div>

      <div className="kv">
        <span>replay map</span>
        <strong>{calibration.replayMapName || '—'}</strong>
      </div>

      <label className="field">
        <span>heightScale</span>
        <input
          type="number"
          step="0.000001"
          value={calibration.height.scale}
          onChange={(event) => changeHeightScale(event.target.valueAsNumber)}
        />
      </label>

      <input
        className="range-input"
        type="range"
        min="0.0001"
        max="0.004"
        step="0.000001"
        value={calibration.height.scale}
        onChange={(event) => changeHeightScale(event.target.valueAsNumber)}
      />

      <label className="field">
        <span>heightOffset</span>
        <input
          type="number"
          step="0.01"
          value={calibration.height.offset}
          onChange={(event) => changeHeightOffset(event.target.valueAsNumber)}
        />
      </label>

      <input
        className="range-input"
        type="range"
        min="-30"
        max="80"
        step="0.01"
        value={calibration.height.offset}
        onChange={(event) => changeHeightOffset(event.target.valueAsNumber)}
      />

      <label className="field">
        <span>object height offset</span>
        <input
          type="number"
          step="0.01"
          value={calibration.objects.heightOffset}
          onChange={(event) => changeObjectHeightOffset(event.target.valueAsNumber)}
        />
      </label>

      <input
        className="range-input"
        type="range"
        min="-10"
        max="10"
        step="0.01"
        value={calibration.objects.heightOffset}
        onChange={(event) => changeObjectHeightOffset(event.target.valueAsNumber)}
      />

      <div className="panel-subtitle">Рисунок поверхности</div>

      <label className="field">
        <span>texture rotation</span>
        <select
          value={calibration.texture.rotationDegrees}
          onChange={(event) => changeTextureRotation(Number(event.target.value))}
        >
          <option value={0}>0°</option>
          <option value={90}>90°</option>
          <option value={180}>180°</option>
          <option value={270}>270°</option>
        </select>
      </label>

      <label className="check-field">
        <input
          type="checkbox"
          checked={calibration.texture.flipU}
          onChange={(event) => changeTextureFlipU(event.target.checked)}
        />
        <span>flipU</span>
      </label>

      <label className="check-field">
        <input
          type="checkbox"
          checked={calibration.texture.flipV}
          onChange={(event) => changeTextureFlipV(event.target.checked)}
        />
        <span>flipV</span>
      </label>

      <div className="button-row">
        <button onClick={onPreview}>Применить в viewer</button>
        <button onClick={onSave}>Сохранить JSON</button>
        <button onClick={copyCalibrationJson}>Copy JSON</button>
      </div>
    </>
  );
}