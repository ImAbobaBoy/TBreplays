import type {
  AppState,
  ViewerTool,
} from '../../app/AppState';
import type {
  ManualTankModel,
  TankTeamKind,
  TankVisualKey,
} from '../../domain/TankModels';

type WorkspacePanelProps = {
  state: AppState;
  onMapIdChange: (mapId: string) => void;
  onReplayIdChange: (replayId: string) => void;
  onLoadMap: () => void;
  onSelectedToolChange: (tool: ViewerTool) => void;
  onDrawingColorChange: (color: string) => void;
  onClearDrawings: () => void;
  onManualTankChange: (tank: ManualTankModel) => void;
  onDeleteSelectedManualTank: () => void;
  onClearManualTanks: () => void;
};

const drawingColors = [
  '#ffff00',
  '#ffffff',
  '#ef4444',
  '#22c55e',
  '#38bdf8',
  '#a855f7',
];

const tankVisualOptions: Array<{
  value: TankVisualKey;
  label: string;
}> = [
  { value: 'light', label: 'Лёгкий' },
  { value: 'medium', label: 'Средний' },
  { value: 'heavy', label: 'Тяжёлый' },
  { value: 'td', label: 'ПТ-САУ' },
];

const tankTeamOptions: Array<{
  value: TankTeamKind;
  label: string;
}> = [
  { value: 'neutral', label: 'Нейтральный' },
  { value: 'ally', label: 'Союзник' },
  { value: 'enemy', label: 'Противник' },
];

export function WorkspacePanel({
  state,
  onMapIdChange,
  onReplayIdChange,
  onLoadMap,
  onSelectedToolChange,
  onDrawingColorChange,
  onClearDrawings,
  onManualTankChange,
  onDeleteSelectedManualTank,
  onClearManualTanks,
}: WorkspacePanelProps) {
  const selectedTank = state.manualTanks.find((tank) => {
    return tank.id === state.selectedManualTankId;
  }) ?? null;

  const updateSelectedTank = (patch: Partial<ManualTankModel>) => {
    if (!selectedTank) {
      return;
    }

    onManualTankChange({
      ...selectedTank,
      ...patch,
    });
  };

  const updateSelectedTankPose = (
    patch: Partial<ManualTankModel['pose']>,
  ) => {
    if (!selectedTank) {
      return;
    }

    onManualTankChange({
      ...selectedTank,
      pose: {
        ...selectedTank.pose,
        ...patch,
      },
    });
  };
  return (
    <section className="panel-card">
      <div className="panel-title">Рабочая поверхность</div>

      <label className="field">
        <span>Map ID</span>
        <input
          value={state.mapId}
          onChange={(event) => onMapIdChange(event.target.value)}
          placeholder="18_canal_cn-..."
        />
      </label>

      <label className="field">
        <span>Replay ID</span>
        <input
          value={state.replayId}
          onChange={(event) => onReplayIdChange(event.target.value)}
          placeholder="battle-..."
        />
      </label>

      <div className="button-row">
        <button onClick={onLoadMap}>Загрузить карту</button>
        <button disabled>Загрузить replay</button>
      </div>

      <div className="panel-subtitle">Рисовалка</div>

      <div className="drawing-tools">
        <button
          className={state.selectedTool === 'select' ? 'active' : ''}
          onClick={() => onSelectedToolChange('select')}
        >
          Камера / выбор
        </button>

        <button
          className={state.selectedTool === 'draw' ? 'active' : ''}
          onClick={() => onSelectedToolChange('draw')}
        >
          Рисовать линию
        </button>

        <button
          className={state.selectedTool === 'erase' ? 'active danger' : 'danger'}
          onClick={() => onSelectedToolChange('erase')}
        >
          Ластик по линии
        </button>

        <button
          className={state.selectedTool === 'tankPlacement' ? 'active' : ''}
          onClick={() => onSelectedToolChange('tankPlacement')}
        >
          Поставить танк
        </button>

        <button onClick={onClearDrawings}>Очистить линии</button>
      </div>

      <div className="color-palette">
        {drawingColors.map((color) => (
          <button
            key={color}
            className={state.drawingColor === color ? 'active' : ''}
            style={{ backgroundColor: color }}
            title={color}
            onClick={() => onDrawingColorChange(color)}
          />
        ))}

        <label className="color-picker">
          <span>Свой</span>
          <input
            type="color"
            value={state.drawingColor}
            onChange={(event) => onDrawingColorChange(event.target.value)}
          />
        </label>
      </div>

      <div className="hint">
        Выбери «Рисовать линию» и тяни мышью по terrain. Ластик удаляет всю линию целиком:
        достаточно попасть по любому её участку.
      </div>

            <div className="panel-subtitle">Ручные танки</div>

      <div className="drawing-tools">
        <button
          className={state.selectedTool === 'select' ? 'active' : ''}
          onClick={() => onSelectedToolChange('select')}
        >
          Выбрать / двигать
        </button>

        <button onClick={onClearManualTanks}>Очистить танки</button>
      </div>

      {selectedTank ? (
        <div className="tank-editor">
          <label className="field">
            <span>Надпись над танком</span>
            <input
              value={selectedTank.label}
              onChange={(event) => updateSelectedTank({
                label: event.target.value,
              })}
            />
          </label>

          <label className="field">
            <span>Тип танка</span>
            <select
              value={selectedTank.visualKey}
              onChange={(event) => updateSelectedTank({
                visualKey: event.target.value as TankVisualKey,
              })}
            >
              {tankVisualOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Команда</span>
            <select
              value={selectedTank.team}
              onChange={(event) => updateSelectedTank({
                team: event.target.value as TankTeamKind,
              })}
            >
              {tankTeamOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Цвет танка</span>
            <input
              type="color"
              value={selectedTank.color}
              onChange={(event) => updateSelectedTank({
                color: event.target.value,
              })}
            />
          </label>

          <label className="field">
            <span>Поворот корпуса: {selectedTank.pose.bodyYawDegrees.toFixed(0)}°</span>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={selectedTank.pose.bodyYawDegrees}
              onChange={(event) => updateSelectedTankPose({
                bodyYawDegrees: event.target.valueAsNumber,
              })}
            />
          </label>

          <label className="field">
            <span>Поворот башни: {selectedTank.pose.turretYawDegrees.toFixed(0)}°</span>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={selectedTank.pose.turretYawDegrees}
              onChange={(event) => updateSelectedTankPose({
                turretYawDegrees: event.target.valueAsNumber,
              })}
            />
          </label>

          <div className="kv wide-kv">
            <span>Позиция</span>
            <strong>
              {selectedTank.pose.x.toFixed(1)} / {selectedTank.pose.y.toFixed(1)} / {selectedTank.pose.z.toFixed(1)}
            </strong>
          </div>

          <button
            className="danger-action"
            onClick={onDeleteSelectedManualTank}
          >
            Удалить выбранный танк
          </button>
        </div>
      ) : (
        <div className="hint">
          Нажми «Поставить танк» и кликни по terrain. Потом в режиме «Выбрать / двигать»
          танк можно перетаскивать мышью.
        </div>
      )}

      <div className="panel-subtitle">Будущие инструменты</div>

      <div className="tool-grid">
        <button disabled>Маркер</button>
        <button disabled>Танк</button>
        <button disabled>Стрелка</button>
        <button disabled>Зона</button>
      </div>

      <div className="hint">
        Следующий слой — стратегический планировщик: маркеры, стрелки, зоны, ручная постановка танков,
        экспорт разбора и совместный просмотр.
      </div>
    </section>
  );
}