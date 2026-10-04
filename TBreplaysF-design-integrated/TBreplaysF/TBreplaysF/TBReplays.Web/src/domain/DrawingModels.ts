export type DrawingPoint = {
  x: number;
  y: number;
  z: number;
};

export type DrawingStrokeStyle = 'solid' | 'dashed' | 'marker' | 'text';

export type DrawingArrowModeValue = 'none' | 'dot' | 'end';

export type DrawingStrokeModel = {
  id: string;
  color: string;
  width: number;
  style: DrawingStrokeStyle;
  arrowMode: DrawingArrowModeValue;
  points: DrawingPoint[];
  text?: string | null;
};
