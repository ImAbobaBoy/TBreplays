// Owns prepared map scenes for this viewer session. Failed loads can be retried.
export class MapSceneSessionCache<T extends { dispose(): void; bytes(): number }> {
  private entries = new Map<string, { promise: Promise<T>; value?: T }>();
  private closed = false;
  private readonly create: (id: string) => Promise<T>;
  public constructor(create: (id: string) => Promise<T>) {
    this.create = create;
  }
  public async get(id: string, _visited = true): Promise<T> {
    if (this.closed) throw new Error('Кеш карт закрыт.');
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { promise: Promise.resolve().then(() => this.create(id)) };
      const owned = entry;
      this.entries.set(id, entry);
      entry.promise = entry.promise.then(value => {
        if (this.closed) { value.dispose(); throw new Error('Кеш карт закрыт.'); }
        owned.value = value;
        return value;
      }).catch(error => { this.entries.delete(id); throw error; });
    }
    return entry.promise;
  }
  public has(id: string): boolean { return this.entries.has(id); }
  public dispose(): void {
    this.closed = true;
    for (const entry of this.entries.values()) entry.value?.dispose();
    this.entries.clear();
  }
}
