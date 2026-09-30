import { createId } from '../../utils/createId';
import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { API_BASE, onlineRequest } from '../../api/OnlineHttp';
import { applySketchChange } from './OnlineModels';
import type { OnlineState, OnlineUser, SketchState, SketchChange, SketchCommand, SketchResult } from './OnlineModels';

export class OnlineClient {
  private readonly hub = new HubConnectionBuilder().withUrl(`${API_BASE}/hubs/sketch`, { withCredentials: true })
    .withAutomaticReconnect([0, 2000, 5000, 10000]).configureLogging(LogLevel.Warning).build();
  private state: OnlineState = { board: null, users: [], status: 'connecting', pending: false, message: '' };
  private listeners = new Set<() => void>();
  private disposed = false;
  private refreshTask: Promise<void> | null = null;
  private buffered: SketchChange[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  constructor() {
    this.hub.on('SketchSnapshot', (board: SketchState) => this.accept(board));
    this.hub.on('SketchChanged', (change: SketchChange) => this.receive(change));
    this.hub.on('UsersChanged', (users: OnlineUser[]) => this.publish({ users }));
    this.hub.onreconnecting(() => { this.publish({ status: 'reconnecting', message: 'Связь потеряна. Восстанавливаю…' }); void this.checkSession(); });
    this.hub.onreconnected(() => { void this.refresh().then(() => this.publish({ status: 'connected', message: '' })).catch(() => this.publish({ status: 'offline', message: 'Не удалось восстановить доску. Нажмите «Подключиться».' })); });
    this.hub.onclose(() => { if (!this.disposed) { this.publish({ status: 'offline', users: [], message: 'Соединение закрыто.' }); void this.checkSession(); } });
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
      await this.refresh();
      this.publish({ users: await this.hub.invoke<OnlineUser[]>('GetUsers'), status: 'connected' });
      if (!this.timer) this.timer = setInterval(() => {
        if (this.state.status === 'connected') void this.refresh().catch(() => this.publish({ status: 'offline', message: 'Нет связи с сервером.' }));
      }, 30000);
    } catch (error) { this.publish({ status: 'offline', message: error instanceof Error ? error.message : 'Нет связи с сервером.' }); }
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
