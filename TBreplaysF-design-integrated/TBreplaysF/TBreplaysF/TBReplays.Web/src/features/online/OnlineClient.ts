import { createId } from '../../utils/createId';
import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { API_BASE, onlineRequest } from '../../api/OnlineHttp';
import { applySketchChange } from './OnlineModels';
import type { ReplaySyncState, ReplayCommand, ReplayTiming, ReplaySyncResult, OnlineState, OnlineUser, SketchState, SketchChange, SketchCommand, SketchResult } from './OnlineModels';

export class OnlineClient {
  private readonly hub = new HubConnectionBuilder().withUrl(`${API_BASE}/hubs/sketch`, { withCredentials: true })
    .withAutomaticReconnect([0, 2000, 5000, 10000]).configureLogging(LogLevel.Warning).build();
  private state: OnlineState = { board: null, users: [], status: 'connecting', pending: false, message: '', replay: null, connectionId: null, clockOffsetMs: 0, replayPending: false, replayMessage: '' };
  private listeners = new Set<() => void>();
  private disposed = false;
  private refreshTask: Promise<void> | null = null;
  private buffered: SketchChange[] = [];
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
  private accept(board: SketchState) {
    if (this.state.board && board.revision < this.state.board.revision) return;
    this.publish({ board });
  }
  private receive(change: SketchChange) {
    if (this.refreshTask) { this.buffered.push(change); return; }
    const board = applySketchChange(this.state.board, change);
    if (board) this.accept(board);
    else { this.buffered.push(change); void this.refresh().catch(() => this.publish({ status: 'offline', message: 'Доска не синхронизирована. Подключитесь снова.' })); }
  }
  async refresh(): Promise<void> {
    if (this.refreshTask) return this.refreshTask;
    this.refreshTask = (async () => {
      const board = await onlineRequest<SketchState>('/api/sketch');
      this.accept(board);
      const changes = this.buffered.splice(0).sort((a, b) => a.revision - b.revision);
      for (const change of changes) {
        const next = applySketchChange(this.state.board, change);
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
  async apply(command: Omit<SketchCommand, 'operationId' | 'mapRevision'> & { mapRevision?: number }) {
    const board = this.state.board;
    if (!board || this.state.status !== 'connected' || this.state.pending) throw new Error('Дождитесь подключения и сохранения предыдущего рисунка.');
    const request: SketchCommand = { ...command, operationId: createId(), mapRevision: command.mapRevision ?? board.mapRevision };
    this.publish({ pending: true, message: '' });
    try {
      // HTTP and SignalR use the same server command service. HTTP has CSRF and a clear error status.
      const result = await onlineRequest<SketchResult>('/api/sketch/commands', 'POST', request);
      if (!result.applied) throw new Error(result.error ?? 'Не удалось сохранить рисунок.');
      if (result.change) this.receive(result.change);
    } catch (error) {
      // Do not replay a potentially stale edit after reconnect; authoritative state resolves lost acknowledgements.
      const refreshed = await this.refresh().then(() => true).catch(() => false);
      const message = error instanceof Error ? error.message : 'Ошибка сохранения.';
      this.publish({ ...(refreshed ? {} : { status: 'offline' as const }), message: `Правка не подтверждена. ${refreshed ? 'Доска обновлена с сервера.' : 'Не удалось получить состояние доски. Подключитесь снова.'} ${message}` });
      throw error;
    } finally { this.publish({ pending: false }); }
  }
  dispose() { this.disposed = true; if (this.timer) clearInterval(this.timer); this.listeners.clear(); void this.hub.stop(); }
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
