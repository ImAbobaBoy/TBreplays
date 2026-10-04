// Owns prepared map scenes for this viewer session. Failed loads can be retried.
export class MapSceneSessionCache<T extends { dispose(): void; bytes(): number }> {
  private entries = new Map<string, { promise: Promise<T>; value?: T; visited: boolean }>();
  private closed = false;
  private readonly create: (id: string) => Promise<T>;
  private readonly budget: number;
  public constructor(create: (id: string) => Promise<T>, budget = 768 * 1024 * 1024) {
    this.create = create; this.budget = budget;
  }
  public async get(id: string, visited = true): Promise<T> {
    if (this.closed) throw new Error('Кеш карт закрыт.');
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { visited, promise: Promise.resolve().then(() => this.create(id)) };
      const owned = entry;
      this.entries.set(id, entry);
      entry.promise = entry.promise.then(value => {
        if (this.closed) { value.dispose(); throw new Error('Кеш карт закрыт.'); }
        owned.value = value;
        return value;
      }).catch(error => { this.entries.delete(id); throw error; });
    }
    entry.visited ||= visited;
    this.entries.delete(id); this.entries.set(id, entry);
    return entry.promise;
  }
  public trim(activeId: string | null): void {
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + (entry.value?.bytes() ?? 0), 0);
    const oldest = [...this.entries].sort((a, b) => Number(a[1].visited) - Number(b[1].visited));
    for (const [id, entry] of oldest) {
      if (bytes <= this.budget) break;
      if (id === activeId || !entry.value) continue;
      bytes -= entry.value.bytes(); entry.value.dispose(); this.entries.delete(id);
    }
  }
  public has(id: string): boolean { return this.entries.has(id); }
  public dispose(): void {
    this.closed = true;
    for (const entry of this.entries.values()) entry.value?.dispose();
    this.entries.clear();
  }
}
