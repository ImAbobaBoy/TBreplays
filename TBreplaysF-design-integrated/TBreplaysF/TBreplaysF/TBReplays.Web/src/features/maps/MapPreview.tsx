import { useState } from 'react';

// Vite gives these files content hashes. Only displayed images are downloaded.
const images = import.meta.glob<string>('../../assets/mapPreviews/*.webp', {
  eager: true, query: '?url', import: 'default',
});

export function MapPreview({ mapId, title, thumbnail = false }: {
  mapId: string; title: string; thumbnail?: boolean;
}) {
  const name = mapId.replace(/-[a-f0-9]{8}$/, '');
  const src = images[`../../assets/mapPreviews/${name}${thumbnail ? '.thumb' : ''}.webp`];
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <span className="map-preview-unavailable">Превью недоступно</span>;
  return <img className="map-preview-image" src={src} alt={title} width={thumbnail ? 240 : 640}
    height={thumbnail ? 240 : 640} loading={thumbnail ? 'lazy' : 'eager'} decoding="async"
    draggable={false} onError={() => setFailedSrc(src)} />;
}
