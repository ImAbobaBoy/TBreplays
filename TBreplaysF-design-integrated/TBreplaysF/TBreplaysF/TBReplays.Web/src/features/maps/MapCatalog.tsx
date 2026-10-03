import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onlineRequest } from '../../api/OnlineHttp';
import type { WorkspaceMapDefinition } from '../../domain/WorkspaceModels';
type Entry = { name: string; displayName: string; replayMapNames: string[] };
const Context = createContext<{maps: WorkspaceMapDefinition[]; loading: boolean; error: string; reload: () => Promise<void>}>({maps: [], loading: true, error: '', reload: async () => {}});
export function MapCatalogProvider({ children }: { children: ReactNode }) {
  const [maps, setMaps] = useState<WorkspaceMapDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = async () => {
    setLoading(true); setError('');
    try {
      const entries = await onlineRequest<Entry[]>('/api/maps');
      setMaps(entries.map(x => ({id: x.name, title: x.displayName, subtitle: x.name, replayMapName: x.replayMapNames[0] ?? x.name, replayMapNames: x.replayMapNames})));
    } catch(e) { setError(e instanceof Error ? e.message : 'Не удалось загрузить каталог карт'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, []);
  return <Context.Provider value={{maps, loading, error, reload}}>{children}</Context.Provider>;
}
export const useMapCatalog = () => useContext(Context);
