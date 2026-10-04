const colorSliderStops = [
  { position: 0, color: '#ff3b00' },
  { position: 180, color: '#ffd400' },
  { position: 380, color: '#00e35f' },
  { position: 580, color: '#00c9ff' },
  { position: 740, color: '#1d30ff' },
  { position: 1000, color: '#ff00c8' },
];

export const initialSwatchPositions = [182, 112, 742, 384, 1000];

export function interpolateColor(position: number): string {
  const clamped = Math.max(0, Math.min(1000, position));

  for (let index = 0; index < colorSliderStops.length - 1; index += 1) {
    const current = colorSliderStops[index];
    const next = colorSliderStops[index + 1];

    if (clamped >= current.position && clamped <= next.position) {
      const factor = (clamped - current.position) / (next.position - current.position);
      const start = hexToRgb(current.color);
      const end = hexToRgb(next.color);
      return rgbToHex({
        r: start.r + (end.r - start.r) * factor,
        g: start.g + (end.g - start.g) * factor,
        b: start.b + (end.b - start.b) * factor,
      });
    }
  }

  return colorSliderStops[colorSliderStops.length - 1].color;
}

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }) {
  const parts = [r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'));
  return `#${parts.join('')}`;
}

export const INITIAL_DRAWING_COLOR = interpolateColor(initialSwatchPositions[0]);
