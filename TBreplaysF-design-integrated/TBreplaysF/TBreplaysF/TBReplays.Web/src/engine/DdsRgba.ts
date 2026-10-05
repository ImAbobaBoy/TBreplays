/** Decode BC1/BC2/BC3 without GPU extensions. Channels stay in the source color space. */
export function decodeDxt(data: Uint8Array, width: number, height: number,
  kind: 'DXT1' | 'DXT3' | 'DXT5', stride = 1, bc1Alpha = true): Uint8Array {
  const blockSize = kind === 'DXT1' ? 8 : 16;
  const columns = Math.ceil(width / 4), rows = Math.ceil(height / 4);
  if (data.length < columns * rows * blockSize) throw new Error('Повреждён блок DDS');
  const outputWidth = Math.max(1, Math.ceil(width / stride));
  const outputHeight = Math.max(1, Math.ceil(height / stride));
  const output = new Uint8Array(outputWidth * outputHeight * 4);
  const colors = new Uint8Array(16), alpha = new Uint8Array(8);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let by = 0; by < rows; by++) for (let bx = 0; bx < columns; bx++) {
    if (stride >= 4 && ((bx * 4) % stride || (by * 4) % stride)) continue;
    const offset = (by * columns + bx) * blockSize;
    const colorOffset = offset + (kind === 'DXT1' ? 0 : 8);
    const first = view.getUint16(colorOffset, true), second = view.getUint16(colorOffset + 2, true);
    for (let i = 0; i < 2; i++) {
      const c = i ? second : first;
      const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
      colors[i * 4] = (r << 3) | (r >> 2);
      colors[i * 4 + 1] = (g << 2) | (g >> 4);
      colors[i * 4 + 2] = (b << 3) | (b >> 2);
      colors[i * 4 + 3] = 255;
    }
    const opaque = kind !== 'DXT1' || first > second;
    for (let channel = 0; channel < 3; channel++) {
      colors[8 + channel] = opaque ? Math.floor((2 * colors[channel] + colors[4 + channel]) / 3)
        : Math.floor((colors[channel] + colors[4 + channel]) / 2);
      colors[12 + channel] = opaque ? Math.floor((colors[channel] + 2 * colors[4 + channel]) / 3) : 0;
    }
    colors[11] = 255; colors[15] = opaque || !bc1Alpha ? 255 : 0;
    if (kind === 'DXT5') {
      alpha[0] = data[offset]; alpha[1] = data[offset + 1];
      if (alpha[0] > alpha[1]) {
        for (let i = 2; i < 8; i++) alpha[i] = Math.floor(((8 - i) * alpha[0] + (i - 1) * alpha[1]) / 7);
      } else {
        for (let i = 2; i < 6; i++) alpha[i] = Math.floor(((6 - i) * alpha[0] + (i - 1) * alpha[1]) / 5);
        alpha[6] = 0; alpha[7] = 255;
      }
    }
    const indices = view.getUint32(colorOffset + 4, true);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const sx = bx * 4 + x, sy = by * 4 + y;
      if (sx >= width || sy >= height || sx % stride || sy % stride) continue;
      const pixel = y * 4 + x, c = ((indices >>> (pixel * 2)) & 3) * 4;
      const target = ((sy / stride) * outputWidth + sx / stride) * 4;
      output[target] = colors[c]; output[target + 1] = colors[c + 1];
      output[target + 2] = colors[c + 2]; output[target + 3] = colors[c + 3];
      if (kind === 'DXT3') output[target + 3] = ((data[offset + (pixel >> 1)] >> ((pixel & 1) * 4)) & 15) * 17;
      if (kind === 'DXT5') {
        const bit = pixel * 3, byte = offset + 2 + (bit >> 3), shift = bit & 7;
        // Read only the six alpha-index bytes; the last pixel fits in the final byte.
        const bits = data[byte] | ((byte < offset + 7 ? data[byte + 1] : 0) << 8);
        output[target + 3] = alpha[(bits >> shift) & 7];
      }
    }
  }
  return output;
}

export function reduceRgba(data: Uint8Array, width: number, height: number, stride: number): Uint8Array {
  const w = Math.max(1, Math.ceil(width / stride)), h = Math.max(1, Math.ceil(height / stride));
  const result = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const source = (y * stride * width + x * stride) * 4;
    result.set(data.subarray(source, source + 4), (y * w + x) * 4);
  }
  return result;
}
