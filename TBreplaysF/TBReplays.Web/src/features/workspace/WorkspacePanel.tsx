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
  onImportLocalReplay: () => void;
  onLoadReplay: () => void;
  onSelectedToolChange: (tool: ViewerTool) => void;
  onDrawingColorChange: (color: string) => void;
  onClearDrawings: () => void;
  onManualTankChange: (tank: ManualTankModel) => void;
  onDeleteSelectedManualTank: () => void;
  onClearManualTanks: () => void;
};

const drawingColors = [
  '#facc15',
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
  { value: 'light', label: 'ЛТ' },
  { value: 'medium', label: 'СТ' },
  { value: 'heavy', label: 'ТТ' },
  { value: 'td', label: 'ПТ' },
];

const tankTeamOptions: Array<{
  value: TankTeamKind;
  label: string;
}> = [
  { value: 'neutral', label: 'Нейтральный' },
  { value: 'ally', label: 'Союзники' },
  { value: 'enemy', label: 'Противник' },
];

export function WorkspacePanel({
  state,
  onMapIdChange,
  onReplayIdChange,
  onLoadMap,
  onImportLocalReplay,
  onLoadReplay,
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
    <section className="panel-card workspace-card">
      <div className="panel-kicker">ДЕЙСТВИЯ</div>

      <div className="load-grid">
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
          <span>Replay ID</span>
          <input
            value={state.replayId}
            onChange={(event) => onReplayIdChange(event.target.value)}
            placeholder="replay id"
          />
        </label>

        <button className="action-button" onClick={onImportLocalReplay}>
          <span className="action-icon">⟳</span>
          <span>Импорт replay</span>
        </button>

        <button className="action-button" onClick={onLoadReplay}>
          <span className="action-icon">▶</span>
          <span>Загрузить replay</span>
        </button>

        <button className="action-button" disabled title="Функция импорта картинки карты пока не подключена в props/API.">
          <span className="action-icon">▧</span>
          <span>Импорт картинки</span>
        </button>
      </div>

      <div className="panel-kicker">ИНСТРУМЕНТЫ</div>

      <div className="tool-grid tool-grid--workspace">
        <ToolButton
          active={state.selectedTool === 'select'}
          icon="↖"
          title="Камера / выбор"
          description="орбита и drag объектов"
          onClick={() => onSelectedToolChange('select')}
        />

        <ToolButton
          active={state.selectedTool === 'draw'}
          icon="⌁"
          title="Рисовать линию"
          description="drag по terrain"
          onClick={() => onSelectedToolChange('draw')}
        />

        <ToolButton
          active={state.selectedTool === 'erase'}
          tone="danger"
          icon="⌫"
          title="Ластик по линии"
          description="удаляет линию целиком"
          onClick={() => onSelectedToolChange('erase')}
        />

        <ToolButton
          active={state.selectedTool === 'tankPlacement'}
          icon="▰"
          title="Поставить танк"
          description="клик по terrain"
          onClick={() => onSelectedToolChange('tankPlacement')}
        />

        <ToolButton
          active={state.selectedTool === 'tankAim'}
          icon="◎"
          title="Прострел / башня"
          description="выбор точки огня"
          onClick={() => onSelectedToolChange('tankAim')}
        />

        <ToolButton
          disabled
          icon="⚑"
          title="Метки"
          description="следующий слой"
          onClick={() => onSelectedToolChange('marker')}
        />
      </div>

      {(state.selectedTool === 'draw' || state.selectedTool === 'erase') && (
        <DrawingSettings
          state={state}
          onDrawingColorChange={onDrawingColorChange}
          onClearDrawings={onClearDrawings}
        />
      )}

      {(state.selectedTool === 'tankPlacement' || state.selectedTool === 'tankAim' || selectedTank) && (
        <TankSettings
          selectedTank={selectedTank}
          selectedTool={state.selectedTool}
          onSelectedToolChange={onSelectedToolChange}
          onUpdateTank={updateSelectedTank}
          onUpdateTankPose={updateSelectedTankPose}
          onDeleteSelectedManualTank={onDeleteSelectedManualTank}
          onClearManualTanks={onClearManualTanks}
        />
      )}

      {state.selectedTool === 'select' && !selectedTank && (
        <div className="context-help">
          <strong>Быстрый сценарий</strong>
          <span>Загрузи карту → импортируй replay → включи рисование или поставь ручной танк. Все replay controls вынесены наверх, чтобы они были доступны и в debug.</span>
        </div>
      )}

      <div className="panel-kicker">БУДУЩИЙ ПЛАНИРОВЩИК</div>

      <div className="future-grid">
        <button disabled>Маркеры</button>
        <button disabled>Стрелки</button>
        <button disabled>Зоны</button>
        <button disabled>Заметки</button>
      </div>
    </section>
  );
}

function DrawingSettings({
  state,
  onDrawingColorChange,
  onClearDrawings,
}: {
  state: AppState;
  onDrawingColorChange: (color: string) => void;
  onClearDrawings: () => void;
}) {
  return (
    <section className="tool-settings-card">
      <div className="panel-subtitle">Настройки линии</div>

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
          <span>Свой цвет</span>
          <input
            type="color"
            value={state.drawingColor}
            onChange={(event) => onDrawingColorChange(event.target.value)}
          />
        </label>
      </div>

      <div className="button-row button-row--split">
        <button onClick={onClearDrawings}>Очистить линии</button>
      </div>

      <div className="hint hint--boxed">
        Выбери цвет до рисования. «Ластик по линии» удаляет всю линию целиком — достаточно попасть по любому её участку.
      </div>
    </section>
  );
}

function TankSettings({
  selectedTank,
  selectedTool,
  onSelectedToolChange,
  onUpdateTank,
  onUpdateTankPose,
  onDeleteSelectedManualTank,
  onClearManualTanks,
}: {
  selectedTank: ManualTankModel | null;
  selectedTool: ViewerTool;
  onSelectedToolChange: (tool: ViewerTool) => void;
  onUpdateTank: (patch: Partial<ManualTankModel>) => void;
  onUpdateTankPose: (patch: Partial<ManualTankModel['pose']>) => void;
  onDeleteSelectedManualTank: () => void;
  onClearManualTanks: () => void;
}) {
  return (
    <section className="tool-settings-card">
      <div className="panel-subtitle">Настройки танка</div>

      <div className="button-row button-row--split">
        <button
          className={selectedTool === 'tankPlacement' ? 'active-soft' : ''}
          onClick={() => onSelectedToolChange('tankPlacement')}
        >
          Поставить танк
        </button>

        <button
          className={selectedTool === 'select' ? 'active-soft' : ''}
          onClick={() => onSelectedToolChange('select')}
        >
          Выбрать / двигать
        </button>
      </div>

      {selectedTank ? (
        <>
          <div className="selected-object-header">
            <span>Выбран</span>
            <strong>{selectedTank.label}</strong>
          </div>

          <label className="field">
            <span>Номер / подпись</span>
            <input
              value={selectedTank.label}
              onChange={(event) => onUpdateTank({
                label: event.target.value,
              })}
            />
          </label>

          <div className="segmented-field">
            <span>Команда</span>
            <div>
              {tankTeamOptions.map((option) => (
                <button
                  key={option.value}
                  className={selectedTank.team === option.value ? 'active' : ''}
                  onClick={() => onUpdateTank({ team: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="segmented-field">
            <span>Класс</span>
            <div>
              {tankVisualOptions.map((option) => (
                <button
                  key={option.value}
                  className={selectedTank.visualKey === option.value ? 'active' : ''}
                  onClick={() => onUpdateTank({ visualKey: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <label className="field color-field">
            <span>Цвет танка</span>
            <input
              type="color"
              value={selectedTank.color}
              onChange={(event) => onUpdateTank({
                color: event.target.value,
              })}
            />
          </label>

          <AngleSlider
            label="Направление корпуса"
            value={selectedTank.pose.bodyYawDegrees}
            onChange={(value) => onUpdateTankPose({ bodyYawDegrees: value })}
          />

          <AngleSlider
            label="Поворот башни"
            value={selectedTank.pose.turretYawDegrees}
            onChange={(value) => onUpdateTankPose({ turretYawDegrees: value })}
          />

          <div className="kv wide-kv">
            <span>Позиция</span>
            <strong>
              {selectedTank.pose.x.toFixed(1)} / {selectedTank.pose.y.toFixed(1)} / {selectedTank.pose.z.toFixed(1)}
            </strong>
          </div>

          <button
            className={selectedTool === 'tankAim' ? 'active-soft full-width' : 'full-width'}
            onClick={() => onSelectedToolChange('tankAim')}
          >
            Навести башню / поставить прострел
          </button>

          {selectedTank.aimTarget ? (
            <div className="hint hint--boxed">
              Точка прострела: {selectedTank.aimTarget.x.toFixed(1)} / {selectedTank.aimTarget.y.toFixed(1)} / {selectedTank.aimTarget.z.toFixed(1)}. В режиме прострела перетащи голубую точку или кликни в новое место.
            </div>
          ) : (
            <div className="hint hint--boxed">
              Нажми «Навести башню / поставить прострел» и кликни по terrain. Башня повернётся в выбранную точку.
            </div>
          )}

          <button
            className="danger-action full-width"
            onClick={onDeleteSelectedManualTank}
          >
            Удалить выбранный танк
          </button>
        </>
      ) : (
        <div className="empty-note">
          Поставь танк кликом по terrain или выбери существующий в режиме «Камера / выбор». После выбора здесь появятся команда, класс, корпус, башня и прострел.
        </div>
      )}

      <button className="danger-action danger-action--subtle full-width" onClick={onClearManualTanks}>
        Очистить все ручные танки
      </button>
    </section>
  );
}

function ToolButton({
  active,
  disabled,
  icon,
  title,
  description,
  tone,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: string;
  title: string;
  description: string;
  tone?: 'danger';
  onClick: () => void;
}) {
  const className = [
    'tool-button',
    active ? 'active' : '',
    tone === 'danger' ? 'tool-button--danger' : '',
  ].filter(Boolean).join(' ');

  return (
    <button className={className} disabled={disabled} onClick={onClick}>
      <span className="tool-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </button>
  );
}

function AngleSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field angle-field">
      <span>{label}: {value.toFixed(0)}°</span>
      <input
        type="range"
        min={-180}
        max={180}
        step={1}
        value={value}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    </label>
  );
}
