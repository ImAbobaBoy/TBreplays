import * as THREE from 'three';

export function textSignLines(text: string): string[] {
  // The same wrapping is used by the billboard and the PNG overlay.
  return text.replace(/\r/g, '').split('\n').flatMap(line => {
    const result: string[] = [];
    let remainder = line;
    while (remainder.length > 36) {
      const space = remainder.lastIndexOf(' ', 36);
      const end = space > 12 ? space : 36;
      result.push(remainder.slice(0, end)); remainder = remainder.slice(end).trimStart();
    }
    result.push(remainder); return result;
  });
}

export function paintTextSign(context: CanvasRenderingContext2D, text: string, color: string, fontSize: number,
  x: number, y: number): { width: number; height: number } {
  const lines = textSignLines(text), padding = fontSize * .5, lineHeight = fontSize * 1.3;
  context.save();
  context.font = `600 ${fontSize}px Arial, sans-serif`;
  const width = Math.max(fontSize, ...lines.map(line => context.measureText(line).width)) + padding * 2;
  const height = lines.length * lineHeight + padding * 2;
  const left = x - width / 2, top = y - height;
  context.fillStyle = 'rgba(15,19,24,.92)'; context.fillRect(left, top, width, height);
  context.strokeStyle = color; context.lineWidth = Math.max(1, fontSize / 16);
  context.strokeRect(left, top, width, height);
  context.fillStyle = color; context.textAlign = 'center'; context.textBaseline = 'middle';
  lines.forEach((line, i) => context.fillText(line, x, top + padding + lineHeight * (i + .5)));
  context.restore(); return { width, height };
}

export function createTextSign(text: string, color: string, fontSize: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Не удалось создать текстовую табличку.');
  const size = paintTextSign(context, text, color, 32, 0, 0);
  canvas.width = Math.ceil(size.width); canvas.height = Math.ceil(size.height);
  paintTextSign(context, text, color, 32, canvas.width / 2, canvas.height);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false }));
  sprite.name = 'tactical_text_sign'; sprite.center.set(.5, 0);
  sprite.scale.set(size.width / 32 * fontSize, size.height / 32 * fontSize, 1);
  sprite.renderOrder = 1002; return sprite;
}
