import type {
  CoordinateTransformCalibration,
  MapCalibration,
} from '../../domain/MapCalibration';

type CalibrationDebugEditorProps = {
  calibration: MapCalibration | null;
  onChange: (calibration: MapCalibration) => void;
  onPreview: () => void;
  onSave: () => void;
};

type NumberEditorProps = {
  label: string;
  description: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
};

type ToggleEditorProps = {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
};

type TransformSectionProps = {
  title: string;
  description: string;
  transform: CoordinateTransformCalibration;
  onChange: (transform: CoordinateTransformCalibration) => void;
};

export function CalibrationDebugEditor({
  calibration,
  onChange,
  onPreview,
  onSave,
}: CalibrationDebugEditorProps) {
  if (!calibration) {
    return (
      <div className="hint">
        Загрузи карту, и здесь появится черновик map_calibration.json.
      </div>
    );
  }

  const updateCalibration = (next: MapCalibration) => {
    onChange({
      ...next,
      height: {
        ...next.height,
        source: 'manual-debug-ui',
      },
    });
  };

  const updateWorld = (horizontalHalfExtent: number) => {
    if (!Number.isFinite(horizontalHalfExtent) || horizontalHalfExtent <= 0) {
      return;
    }

    updateCalibration({
      ...calibration,
      world: {
        ...calibration.world,
        horizontalHalfExtent,
      },
    });
  };

  const updateHeightScale = (scale: number) => {
    if (!Number.isFinite(scale) || scale <= 0) {
      return;
    }

    updateCalibration({
      ...calibration,
      height: {
        ...calibration.height,
        scale,
      },
    });
  };

  const updateHeightOffset = (offset: number) => {
    if (!Number.isFinite(offset)) {
      return;
    }

    updateCalibration({
      ...calibration,
      height: {
        ...calibration.height,
        offset,
      },
    });
  };

  const updateObjectHeightOffset = (heightOffset: number) => {
    if (!Number.isFinite(heightOffset)) {
      return;
    }

    updateCalibration({
      ...calibration,
      objects: {
        ...calibration.objects,
        heightOffset,
      },
    });
  };

  const updateTextureRotation = (rotationDegrees: number) => {
    if (!Number.isFinite(rotationDegrees)) {
      return;
    }

    updateCalibration({
      ...calibration,
      texture: {
        ...calibration.texture,
        rotationDegrees,
      },
    });
  };

  const updateTextureFlipU = (flipU: boolean) => {
    updateCalibration({
      ...calibration,
      texture: {
        ...calibration.texture,
        flipU,
      },
    });
  };

  const updateTextureFlipV = (flipV: boolean) => {
    updateCalibration({
      ...calibration,
      texture: {
        ...calibration.texture,
        flipV,
      },
    });
  };

  const copyCalibrationJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(calibration, null, 2));
  };

  return (
    <>
      <div className="debug-section">
        <div className="panel-subtitle">Паспорт карты</div>

        <InfoRow label="mapKey" value={calibration.mapKey} />
        <InfoRow label="replay map" value={calibration.replayMapName || '—'} />
        <InfoRow label="height source" value={calibration.height.source} />
        <InfoRow label="confidence" value={calibration.height.confidence.toFixed(4)} />

        {calibration.height.note && (
          <div className="hint">{calibration.height.note}</div>
        )}
      </div>

      <div className="debug-section">
        <div className="panel-subtitle">Размер мира</div>

        <NumberEditor
          label="Половина размера карты по X/Z"
          description="300 означает координаты terrain примерно от -300 до 300. Меняет горизонтальный масштаб карты."
          value={calibration.world.horizontalHalfExtent}
          step={1}
          min={50}
          max={600}
          onChange={updateWorld}
        />
      </div>

      <div className="debug-section">
        <div className="panel-subtitle">Высота terrain</div>

        <NumberEditor
          label="Множитель raw heightmap"
          description="Формула: y = rawHeight × scale + offset. Для Canal около 0.002120, для Fort около 0.001076."
          value={calibration.height.scale}
          step={0.000001}
          min={0.0001}
          max={0.004}
          onChange={updateHeightScale}
        />

        <NumberEditor
          label="Смещение высоты terrain"
          description="Поднимает или опускает весь рельеф по Y после применения scale."
          value={calibration.height.offset}
          step={0.01}
          min={-30}
          max={80}
          onChange={updateHeightOffset}
        />
      </div>

      <TransformSection
        title="Ориентация terrain"
        description="Меняет, как heightmap ложится в Three.js. Для Fort/Canal обычно нужен Flip Z."
        transform={calibration.terrainTransform}
        onChange={(terrainTransform) => updateCalibration({
          ...calibration,
          terrainTransform,
        })}
      />

      <TransformSection
        title="Ориентация replay"
        description="Пока визуально проявится только после подключения replay-слоя. Нужна для наложения танков на terrain."
        transform={calibration.replayTransform}
        onChange={(replayTransform) => updateCalibration({
          ...calibration,
          replayTransform,
        })}
      />

      <div className="debug-section">
        <div className="panel-subtitle">Объекты карты</div>

        <NumberEditor
          label="Смещение объектов по высоте"
          description="Поднимает/опускает дома, деревья, декорации и эффекты относительно terrain."
          value={calibration.objects.heightOffset}
          step={0.01}
          min={-10}
          max={10}
          onChange={updateObjectHeightOffset}
        />
      </div>

      <div className="debug-section">
        <div className="panel-subtitle">Текстура поверхности</div>

        <label className="field">
          <span>Поворот color texture</span>
          <select
            value={calibration.texture.rotationDegrees}
            onChange={(event) => updateTextureRotation(Number(event.target.value))}
          >
            <option value={0}>0° — без поворота</option>
            <option value={90}>90°</option>
            <option value={180}>180°</option>
            <option value={270}>270°</option>
          </select>
        </label>

        <ToggleEditor
          label="Зеркалить texture U"
          description="Горизонтально отражает UV color texture."
          checked={calibration.texture.flipU}
          onChange={updateTextureFlipU}
        />

        <ToggleEditor
          label="Зеркалить texture V"
          description="Вертикально отражает UV color texture."
          checked={calibration.texture.flipV}
          onChange={updateTextureFlipV}
        />
      </div>

      <div className="debug-section">
        <div className="panel-subtitle">Surface bindings</div>

        <InfoRow label="color" value={calibration.surface.colorTexturePath || '—'} />
        <InfoRow label="tileMask" value={calibration.surface.tileMaskPath || '—'} />
        <InfoRow label="tileTexture0" value={calibration.surface.tileTexture0Path || '—'} />

        <div className="hint">
          Сейчас viewer использует только DDS color texture. PVR tileMask/tileTexture0 уже показываем здесь,
          но полноценное смешивание surface layers будет отдельным шагом.
        </div>
      </div>

      <div className="debug-section">
        <div className="panel-subtitle">Heightmap stats</div>

        <InfoRow
          label="size"
          value={`${calibration.heightmapStats.size} × ${calibration.heightmapStats.size}`}
        />
        <InfoRow label="tile" value={String(calibration.heightmapStats.tileSize)} />
        <InfoRow
          label="raw min/max"
          value={`${calibration.heightmapStats.rawMin} / ${calibration.heightmapStats.rawMax}`}
        />
        <InfoRow
          label="raw p01/p50/p99"
          value={`${calibration.heightmapStats.rawP01} / ${calibration.heightmapStats.rawP50} / ${calibration.heightmapStats.rawP99}`}
        />
      </div>

      <div className="debug-section">
        <div className="button-row">
          <button onClick={onPreview}>Применить черновик к карте</button>
          <button onClick={onSave}>Сохранить map_calibration.json</button>
          <button onClick={copyCalibrationJson}>Скопировать JSON</button>
        </div>

        <div className="hint">
          Поля меняют JSON-черновик. Карта в 3D-viewer перестраивается после кнопки «Применить черновик к карте».
        </div>
      </div>
    </>
  );
}

function TransformSection({
  title,
  description,
  transform,
  onChange,
}: TransformSectionProps) {
  const update = (patch: Partial<CoordinateTransformCalibration>) => {
    onChange({
      ...transform,
      ...patch,
    });
  };

  return (
    <div className="debug-section">
      <div className="panel-subtitle">{title}</div>
      <div className="hint">{description}</div>

      <ToggleEditor
        label="Поменять X и Z местами"
        description="Помогает, если карта повернулась на бок из-за перепутанных горизонтальных осей."
        checked={transform.swapXz}
        onChange={(value) => update({ swapXz: value })}
      />

      <ToggleEditor
        label="Зеркалить X"
        description="Отражает карту или replay по оси X."
        checked={transform.flipX}
        onChange={(value) => update({ flipX: value })}
      />

      <ToggleEditor
        label="Зеркалить Z"
        description="Отражает карту или replay по оси Z. Для Fort/Canal terrain обычно включено."
        checked={transform.flipZ}
        onChange={(value) => update({ flipZ: value })}
      />

      <label className="field">
        <span>Поворот вокруг центра</span>
        <select
          value={transform.rotationDegrees}
          onChange={(event) => update({ rotationDegrees: Number(event.target.value) })}
        >
          <option value={0}>0° — без поворота</option>
          <option value={90}>90°</option>
          <option value={180}>180°</option>
          <option value={270}>270°</option>
        </select>
      </label>
    </div>
  );
}

function NumberEditor({
  label,
  description,
  value,
  step,
  min,
  max,
  onChange,
}: NumberEditorProps) {
  const changeValue = (nextValue: number) => {
    if (!Number.isFinite(nextValue)) {
      return;
    }

    onChange(nextValue);
  };

  return (
    <div className="number-editor">
      <label className="field">
        <span>{label}</span>
        <input
          type="number"
          step={step}
          value={value}
          onChange={(event) => changeValue(event.target.valueAsNumber)}
        />
      </label>

      {min !== undefined && max !== undefined && (
        <input
          className="range-input"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => changeValue(event.target.valueAsNumber)}
        />
      )}

      <div className="field-help">{description}</div>
    </div>
  );
}

function ToggleEditor({
  label,
  description,
  checked,
  onChange,
}: ToggleEditorProps) {
  return (
    <label className="check-field debug-check-field">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />

      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="kv wide-kv">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}