import type { AppState } from '../../app/AppState';

export type ReplayControlsProps = {
  state: AppState;
  variant?: 'panel' | 'top';
  onReplayIdChange: (replayId: string) => void;
  onImportLocalReplay: () => void;
  onLoadReplay: () => void;
  onPlayReplay: () => void;
  onPauseReplay: () => void;
  onSeekReplayBy: (deltaSeconds: number) => void;
  onSeekReplayTo: (time: number) => void;
  onReplaySpeedChange: (speed: number) => void;
};

const speedOptions = [0.25, 0.5, 1, 2, 4];

export function ReplayControls({
  state,
  variant = 'panel',
  onReplayIdChange,
  onImportLocalReplay,
  onLoadReplay,
  onPlayReplay,
  onPauseReplay,
  onSeekReplayBy,
  onSeekReplayTo,
  onReplaySpeedChange,
}: ReplayControlsProps) {
  const playback = state.playback;
  const hasReplay = playback.replayId !== null;
  const rangeMax = playback.maxTime > playback.minTime
    ? playback.maxTime
    : playback.minTime + 1;

  const playPauseLabel = playback.isPlaying ? 'Пауза' : 'Пуск';
  const playPauseIcon = playback.isPlaying ? 'Ⅱ' : '▶';

  const togglePlayback = () => {
    if (playback.isPlaying) {
      onPauseReplay();
      return;
    }

    onPlayReplay();
  };

  if (variant === 'top') {
    return (
      <section className="replay-controls replay-controls--top" aria-label="Управление replay">
        <div className="replay-time-row replay-time-row--top">
          <strong>{formatTime(playback.time)}</strong>
          <span>/</span>
          <span>{formatTime(playback.maxTime)}</span>
        </div>

        <div className="replay-transport-row">
          <button disabled={!hasReplay} onClick={() => onSeekReplayBy(-30)}>-30с</button>
          <button disabled={!hasReplay} onClick={() => onSeekReplayBy(-5)}>-5с</button>

          <button
            className="play-button"
            disabled={!hasReplay}
            onClick={togglePlayback}
          >
            <span>{playPauseIcon}</span>
            {playPauseLabel}
          </button>

          <button disabled={!hasReplay} onClick={() => onSeekReplayBy(5)}>+5с</button>
          <button disabled={!hasReplay} onClick={() => onSeekReplayBy(30)}>+30с</button>

          <label className="speed-select-label">
            <span>Скорость</span>
            <select
              value={playback.speed}
              disabled={!hasReplay}
              onChange={(event) => onReplaySpeedChange(Number(event.target.value))}
            >
              {speedOptions.map((speed) => (
                <option key={speed} value={speed}>x{speed}</option>
              ))}
            </select>
          </label>
        </div>

        <input
          className="replay-time-slider replay-time-slider--top"
          type="range"
          min={playback.minTime}
          max={rangeMax}
          step={0.05}
          value={playback.time}
          disabled={!hasReplay}
          onChange={(event) => onSeekReplayTo(event.target.valueAsNumber)}
        />
      </section>
    );
  }

  return (
    <section className="panel-card replay-controls replay-controls--panel">
      <div className="panel-title">Replay</div>

      <label className="field">
        <span>Replay ID</span>
        <input
          value={state.replayId}
          onChange={(event) => onReplayIdChange(event.target.value)}
          placeholder="replay id после import-local"
        />
      </label>

      <div className="button-row">
        <button onClick={onImportLocalReplay}>Импорт replay</button>
        <button onClick={onLoadReplay}>Загрузить replay</button>
      </div>

      <div className="replay-time-row">
        <strong>{formatTime(playback.time)}</strong>
        <span>/</span>
        <span>{formatTime(playback.maxTime)}</span>
      </div>

      <input
        className="replay-time-slider"
        type="range"
        min={playback.minTime}
        max={rangeMax}
        step={0.05}
        value={playback.time}
        disabled={!hasReplay}
        onChange={(event) => onSeekReplayTo(event.target.valueAsNumber)}
      />

      <div className="replay-controls-grid">
        <button disabled={!hasReplay} onClick={() => onSeekReplayBy(-30)}>-30с</button>
        <button disabled={!hasReplay} onClick={() => onSeekReplayBy(-5)}>-5с</button>
        <button disabled={!hasReplay} onClick={togglePlayback}>{playPauseLabel}</button>
        <button disabled={!hasReplay} onClick={() => onSeekReplayBy(5)}>+5с</button>
        <button disabled={!hasReplay} onClick={() => onSeekReplayBy(30)}>+30с</button>
      </div>

      <label className="field">
        <span>Скорость</span>
        <select
          value={playback.speed}
          disabled={!hasReplay}
          onChange={(event) => onReplaySpeedChange(Number(event.target.value))}
        >
          {speedOptions.map((speed) => (
            <option key={speed} value={speed}>x{speed}</option>
          ))}
        </select>
      </label>

      <div className="hint hint--boxed">
        TODO: Для совместного просмотра не слать по SignalR позиции танков и состояние каждый кадр. Синхронизировать только команды: loadReplay, seek, play, pause, changeSpeed.
      </div>
    </section>
  );
}

function formatTime(time: number): string {
  if (!Number.isFinite(time)) {
    return '0:00.00';
  }

  const minutes = Math.floor(time / 60);
  const seconds = time - minutes * 60;

  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}
