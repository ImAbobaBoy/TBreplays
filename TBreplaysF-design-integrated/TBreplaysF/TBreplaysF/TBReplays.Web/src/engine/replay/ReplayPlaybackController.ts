import type { ReplayPlaybackState } from '../../domain/ReplayModels';

export class ReplayPlaybackController {
  private state: ReplayPlaybackState = {
    replayId: null,
    time: 0,
    minTime: 0,
    maxTime: 0,
    isPlaying: false,
    speed: 1,
    revision: 0,
  };

  private lastUpdateTimestampMs: number | null = null;

  public loadReplay(
    replayId: string,
    minTime: number,
    maxTime: number,
  ): ReplayPlaybackState {
    // TODO: Совместный просмотр.
    // Сейчас это локальное состояние проигрывателя в одном браузере.
    // Потом этот переход должен соответствовать SignalR-команде loadReplay(replayId, mapId, revision),
    // а остальные клиенты будут сами грузить parse-result по replayId.
    this.lastUpdateTimestampMs = null;

    this.state = {
      replayId,
      time: minTime,
      minTime,
      maxTime,
      isPlaying: false,
      speed: this.state.speed,
      revision: this.state.revision + 1,
    };

    return this.getState();
  }

  public clear(): ReplayPlaybackState {
    this.lastUpdateTimestampMs = null;

    this.state = {
      replayId: null,
      time: 0,
      minTime: 0,
      maxTime: 0,
      isPlaying: false,
      speed: 1,
      revision: this.state.revision + 1,
    };

    return this.getState();
  }

  public play(timestampMs: number): ReplayPlaybackState {
    if (!this.state.replayId) {
      return this.getState();
    }

    const nextTime = this.state.time >= this.state.maxTime
      ? this.state.minTime
      : this.state.time;

    this.state = {
      ...this.state,
      time: nextTime,
      isPlaying: true,
      revision: this.state.revision + 1,
    };

    this.lastUpdateTimestampMs = timestampMs;

    return this.getState();
  }

  public pause(): ReplayPlaybackState {
    this.lastUpdateTimestampMs = null;

    this.state = {
      ...this.state,
      isPlaying: false,
      revision: this.state.revision + 1,
    };

    return this.getState();
  }

  public seekTo(time: number): ReplayPlaybackState {
    const safeTime = this.clampTime(time);

    this.state = {
      ...this.state,
      time: safeTime,
      revision: this.state.revision + 1,
    };

    this.lastUpdateTimestampMs = null;

    return this.getState();
  }

  public seekBy(deltaSeconds: number): ReplayPlaybackState {
    return this.seekTo(this.state.time + deltaSeconds);
  }

  public setSpeed(speed: number): ReplayPlaybackState {
    if (!Number.isFinite(speed) || speed <= 0) {
      return this.getState();
    }

    this.state = {
      ...this.state,
      speed,
      revision: this.state.revision + 1,
    };

    return this.getState();
  }

  public update(timestampMs: number): ReplayPlaybackState | null {
    if (!this.state.isPlaying || !this.state.replayId) {
      return null;
    }

    if (this.lastUpdateTimestampMs === null) {
      this.lastUpdateTimestampMs = timestampMs;
      return this.getState();
    }

    const deltaSeconds = (timestampMs - this.lastUpdateTimestampMs) / 1000;
    this.lastUpdateTimestampMs = timestampMs;

    const nextTime = this.clampTime(
      this.state.time + deltaSeconds * this.state.speed,
    );

    const reachedEnd = nextTime >= this.state.maxTime;

    this.state = {
      ...this.state,
      time: nextTime,
      isPlaying: reachedEnd ? false : this.state.isPlaying,
    };

    if (reachedEnd) {
      this.lastUpdateTimestampMs = null;
    }

    return this.getState();
  }

  public getState(): ReplayPlaybackState {
    return { ...this.state };
  }

  private clampTime(time: number): number {
    if (!Number.isFinite(time)) {
      return this.state.minTime;
    }

    return Math.min(
      this.state.maxTime,
      Math.max(this.state.minTime, time),
    );
  }
}