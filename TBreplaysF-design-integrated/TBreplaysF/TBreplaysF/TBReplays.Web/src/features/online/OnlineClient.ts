import { createId } from '../../utils/createId';
import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { API_BASE, onlineRequest } from '../../api/OnlineHttp';
import { applyOptimisticSketchCommand, applySketchChange } from './OnlineModels';
import type { ReplaySyncState, ReplayCommand, ReplayTiming, ReplaySyncResult, OnlineState, OnlineUser, SketchState, SketchChange, SketchCommand, SketchResult } from './OnlineModels';

export class OnlineClient {
  private readonly hub = new HubConnectionBuilder().withUrl(`${API_BASE}/hubs/sketch`, { withCredentials: true })
    .withAutomaticReconnect([0, 2000, 5000, 10000]).configureLogging(LogLevel.Warning).build();
  private state: OnlineState = { board: null, users: [], status: 'connecting', pending: false, message: '', replay: null, connectionId: null, clockOffsetMs: 0, replayPending: false, replayMessage: '' };
  private listeners = new Set<() => void>();
  private disposed = false;
  private refreshTask: Promise<void> | null = null;
  private buffered: SketchChange[] = [];
  private confirmedBoard: SketchState | null = null;
  private pendingSketch = new Map<string, {
    request: SketchCommand;
    timer: ReturnType<typeof setTimeout>;
    resolve: () => void;
    reject: (error: Error) => void;
  }>();
  private timer: ReturnType<typeof setInterval> | undefined;
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  constructor() {
    this.hub.on('ReplayChanged', (state: ReplaySyncState) => this.acceptReplay(state));
    this.hub.on('SketchSnapshot', (board: SketchState) => this.accept(board));
    this.hub.on('SketchChanged', (change: SketchChange) => this.receive(change));
    this.hub.on('UsersChanged', (users: OnlineUser[]) => this.publish({ users }));
    this.hub.onreconnecting(() => { this.publish({ status: 'reconnecting', connectionId: null, message: 'Связь потеряна. Восстанавливаю…' }); void this.checkSession(); });
    this.hub.onreconnected(() => { void this.restore().then(() => this.publish({ status: 'connected', message: '' })).catch(() => this.publish({ status: 'offline', message: 'Не удалось восстановить доску. Нажмите «Подключиться».' })); });
    this.hub.onclose(() => { if (!this.disposed) { this.publish({ status: 'offline', connectionId: null, users: [], message: 'Соединение закрыто.' }); void this.checkSession(); } });
  }
  private publish(update: Partial<OnlineState>) { if (this.disposed) return; this.state = { ...this.state, ...update }; this.listeners.forEach(listener => listener()); }
  private optimisticBoard(): SketchState | null {
    if (!this.confirmedBoard) return null;
    let board = this.confirmedBoard;
    for (const pending of this.pendingSketch.values()) board = applyOptimisticSketchCommand(board, pending.request);
    return board;
  }
  private publishBoard(update: Partial<OnlineState> = {}) {
    this.publish({ board: this.optimisticBoard(), pending: this.pendingSketch.size > 0, ...update });
  }
  private accept(board: SketchState) {
    if (this.confirmedBoard && board.revision < this.confirmedBoard.revision) return;
    this.confirmedBoard = board;
    this.publishBoard();
  }
  private completeSketch(operationId: string) {
    const pending = this.pendingSketch.get(operationId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingSketch.delete(operationId);
    pending.resolve();
    return true;
  }
  private failSketch(operationId: string, error: Error, message: string) {
    const pending = this.pendingSketch.get(operationId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingSketch.delete(operationId);
    pending.reject(error);
    this.publishBoard({ message });
    return true;
  }
  private receive(change: SketchChange) {
    if (this.refreshTask) { this.buffered.push(change); return; }
    const board = applySketchChange(this.confirmedBoard, change);
    if (board) {
      this.confirmedBoard = board;
      this.completeSketch(change.operationId);
      this.publishBoard();
    } else {
      this.buffered.push(change);
      void this.refresh().catch(() => this.publish({ status: 'offline', message: 'Доска не синхронизирована. Подключитесь снова.' }));
    }
  }
  async refresh(): Promise<void> {
    if (this.refreshTask) return this.refreshTask;
    this.refreshTask = (async () => {
      const board = await onlineRequest<SketchState>('/api/sketch');
      this.accept(board);
      const changes = this.buffered.splice(0).sort((a, b) => a.revision - b.revision);
      for (const change of changes) {
        const next = applySketchChange(this.confirmedBoard, change);
        if (!next) throw new Error('Пропущена версия доски. Повторите подключение.');
        this.accept(next);
      }
    })().finally(() => { this.refreshTask = null; });
    return this.refreshTask;
  }
  private async checkSession() { try { await onlineRequest('/api/auth/me'); } catch { /* HTTP 401 notifies the session boundary. Network loss keeps local playback. */ } }
  async start() {
    if (this.disposed) return;
    this.publish({ status: 'connecting', message: '' });
    try {
      await onlineRequest('/api/auth/me');
      if (this.disposed) return;
      if (this.hub.state === HubConnectionState.Disconnected) await this.hub.start();
      if (this.disposed) { await this.hub.stop(); return; }
      await this.restore();
      this.publish({ status: 'connected' });
      if (!this.timer) this.timer = setInterval(() => {
        if (this.state.status === 'connected') void Promise.all([this.refresh(), this.refreshReplay()]).catch(() => this.publish({ status: 'offline', message: 'Нет связи с сервером.' }));
      }, 30000);
    } catch (error) { this.publish({ status: 'offline', message: error instanceof Error ? error.message : 'Нет связи с сервером.' }); }
  }
  private acceptReplay(replay: ReplaySyncState) {
    const old = this.state.replay;
    if (old?.serverId === replay.serverId && old.sequence >= replay.sequence) return;
    this.publish({ replay });
  }
  private async restore() {
    this.publish({ connectionId: this.hub.connectionId });
    await this.refresh();
    await this.refreshReplay();
    this.publish({ users: await this.hub.invoke<OnlineUser[]>('GetUsers') });
  }
  async refreshReplay() {
    const sent = Date.now();
    const replay = await this.hub.invoke<ReplaySyncState>('GetReplay');
    const received = Date.now();
    this.publish({ clockOffsetMs: replay.serverNowUnixMs - (sent + received) / 2 });
    this.acceptReplay(replay);
  }
  async replayCommand(command: ReplayCommand) {
    const replay = this.state.replay;
    if (!replay || this.state.status !== 'connected' || this.state.replayPending) return;
    this.publish({ replayPending: true, replayMessage: '' });
    try {
      const result = await this.hub.invoke<ReplaySyncResult>('ReplayApply', {
        ...command, operationId: createId(), sessionId: replay.sessionId, expectedRevision: replay.revision,
      });
      this.acceptReplay(result.state);
      if (!result.applied) throw new Error(replayError(result.error));
    } catch (error) {
      await this.refreshReplay().catch(() => {});
      this.publish({ replayMessage: error instanceof Error ? error.message : 'Не удалось передать команду реплея.' });
    } finally { this.publish({ replayPending: false }); }
  }
  async sendReplayTiming(timing: ReplayTiming) {
    if (this.state.status !== 'connected') return;
    try {
      const result = await this.hub.invoke<ReplaySyncResult>('ReplayHeartbeat', timing);
      this.acceptReplay(result.state);
      if (!result.applied && result.error !== 'replayConflict' && result.error !== 'notLeader')
        this.publish({ replayMessage: replayError(result.error) });
    } catch { /* Reconnect obtains the authoritative state; never queue stale timing. */ }
  }
  apply(command: Omit<SketchCommand, 'operationId' | 'mapRevision'> & { mapRevision?: number }): Promise<void> {
    const board = this.state.board;
    if (!board || this.state.status !== 'connected')
      return Promise.reject(new Error('Дождитесь подключения к общей доске.'));
    const request: SketchCommand = { ...command, operationId: createId(), mapRevision: command.mapRevision ?? board.mapRevision };
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const completion = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
    const timer = setTimeout(() => {
      const error = new Error('Сервер не подтвердил изменение за 2 секунды.');
      if (!this.failSketch(request.operationId, error, 'Правка не подтверждена за 2 секунды. Локальное изменение отменено.')) return;
      void this.refresh().catch(() => this.publish({ status: 'offline', message: 'Не удалось получить состояние доски. Подключитесь снова.' }));
    }, 2000);
    this.pendingSketch.set(request.operationId, { request, timer, resolve, reject });
    // Project the local operation immediately; the server revision stays untouched until confirmation.
    this.publishBoard({ message: '' });
    void (async () => {
      try {
        const result = await onlineRequest<SketchResult>('/api/sketch/commands', 'POST', request);
        if (!result.applied) throw new Error(result.error ?? 'Не удалось сохранить изменение.');
        if (result.change) this.receive(result.change);
        else if (this.completeSketch(request.operationId)) this.publishBoard();
      } catch (failure) {
        const error = failure instanceof Error ? failure : new Error('Ошибка сохранения.');
        if (this.failSketch(request.operationId, error, `Правка отклонена. Локальное изменение отменено. ${error.message}`))
          void this.refresh().catch(() => this.publish({ status: 'offline', message: 'Не удалось получить состояние доски. Подключитесь снова.' }));
      }
    })();
    return completion;
  }
  dispose() {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    for (const pending of this.pendingSketch.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Соединение закрыто.'));
    }
    this.pendingSketch.clear();
    this.listeners.clear();
    void this.hub.stop();
  }
}

function replayError(code: string | null): string {
  const messages: Record<string, string> = {
    forbidden: 'Реплеем может управлять только редактор или администратор.',
    replayConflict: 'Другой участник уже изменил реплей. Состояние обновлено, повторите команду.',
    replayUnavailable: 'Данные реплея недоступны. Импортируйте файл заново.',
    replayMapMismatch: 'Сначала выберите общую карту этого реплея.', mapRequired: 'Сначала выберите общую карту.',
    replayRequired: 'Сначала загрузите реплей.', leaderOffline: 'Ведущий отключён. Выберите реплей, чтобы стать ведущим.',
    invalidTiming: 'Не удалось сверить время. Проверьте связь и обновите страницу.',
  };
  return messages[code ?? ''] ?? 'Команда реплея не подтверждена. Обновите страницу и повторите.';
}
