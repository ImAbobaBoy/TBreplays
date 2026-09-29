import * as THREE from 'three';

import type { TBReplaysApi } from '../../api/TBReplaysApi';
import type { MapCalibration } from '../../domain/MapCalibration';
import type {
  MapManifest,
  TerrainChunkData,
} from '../../domain/MapModels';
import { mapTerrainSampleToThree } from '../MapCalibrationTransforms';

export class TerrainLayer {
  private readonly root: THREE.Group;
  private readonly api: TBReplaysApi;

  private readonly material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  public constructor(
    root: THREE.Group,
    api: TBReplaysApi,
  ) {
    this.root = root;
    this.api = api;
  }

  public getRoot(): THREE.Group {
    return this.root;
  }

  public setTexture(texture: THREE.Texture | null): void {
    if (this.material.map && this.material.map !== texture) {
      this.material.map.dispose();
    }

    this.material.map = texture;
    this.material.color.set(0xffffff);
    this.material.needsUpdate = true;
  }

  public async load(
    manifest: MapManifest,
    calibration: MapCalibration | null,
  ): Promise<void> {
    this.clear();

    const concurrency = 8;
    let currentIndex = 0;

    const workers = Array.from({ length: concurrency }, async () => {
      while (currentIndex < manifest.chunks.length) {
        const index = currentIndex;
        currentIndex++;

        const chunkInfo = manifest.chunks[index];
        const buffer = await this.api.getTerrainChunk(chunkInfo.url);
        const chunk = this.parseTerrainChunk(buffer);
        const mesh = this.createTerrainChunkMesh(
          manifest,
          chunk,
          calibration,
        );

        this.root.add(mesh);
      }
    });

    await Promise.all(workers);
  }

  public clear(): void {
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      this.disposeObject(child);
    }
  }

  public dispose(): void {
    this.clear();

    if (this.material.map) {
      this.material.map.dispose();
    }

    this.material.dispose();
  }

  private parseTerrainChunk(buffer: ArrayBuffer): TerrainChunkData {
    const headerSize = 24;

    if (buffer.byteLength < headerSize) {
      throw new Error('Файл чанка terrain слишком маленький.');
    }

    const view = new DataView(buffer);

    const width = view.getInt32(0, true);
    const height = view.getInt32(4, true);
    const startSampleX = view.getInt32(8, true);
    const startSampleY = view.getInt32(12, true);
    const cellsX = view.getInt32(16, true);
    const cellsY = view.getInt32(20, true);

    if (width <= 0 || height <= 0) {
      throw new Error(`Некорректный размер terrain chunk: ${width}x${height}`);
    }

    const expectedLength = headerSize + width * height * 2;

    if (buffer.byteLength !== expectedLength) {
      throw new Error(
        `Некорректный terrain chunk binary. Ожидалось ${expectedLength}, получено ${buffer.byteLength}.`,
      );
    }

    const heights = new Uint16Array(width * height);

    let offset = headerSize;

    for (let i = 0; i < heights.length; i++) {
      heights[i] = view.getUint16(offset, true);
      offset += 2;
    }

    return {
      width,
      height,
      startSampleX,
      startSampleY,
      cellsX,
      cellsY,
      heights,
    };
  }

  private createTerrainChunkMesh(
    manifest: MapManifest,
    chunk: TerrainChunkData,
    calibration: MapCalibration | null,
  ): THREE.Mesh {
    const vertexCount = chunk.width * chunk.height;

    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);

    for (let y = 0; y < chunk.height; y++) {
      for (let x = 0; x < chunk.width; x++) {
        const vertexIndex = y * chunk.width + x;
        const sampleX = chunk.startSampleX + x;
        const sampleY = chunk.startSampleY + y;

        const normalizedX = sampleX / (manifest.heightmapSize - 1);
        const normalizedY = sampleY / (manifest.heightmapSize - 1);

        const rawHeight = chunk.heights[vertexIndex];
        const horizontalHalfExtent = calibration?.world.horizontalHalfExtent;

        const sourceX = horizontalHalfExtent
          ? -horizontalHalfExtent + normalizedX * horizontalHalfExtent * 2
          : manifest.bounds.minX + normalizedX * manifest.bounds.width;

        const sourceZ = horizontalHalfExtent
          ? -horizontalHalfExtent + normalizedY * horizontalHalfExtent * 2
          : manifest.bounds.minY + normalizedY * manifest.bounds.depth;

        const worldHeight = calibration
          ? rawHeight * calibration.height.scale + calibration.height.offset
          : manifest.bounds.minZ + (rawHeight / 65535) * manifest.bounds.height;

        const position = mapTerrainSampleToThree(
          sourceX,
          sourceZ,
          worldHeight,
          calibration,
        );

        const positionOffset = vertexIndex * 3;
        positions[positionOffset] = position.x;
        positions[positionOffset + 1] = position.y;
        positions[positionOffset + 2] = position.z;

        const uvOffset = vertexIndex * 2;
        uvs[uvOffset] = normalizedX;
        uvs[uvOffset + 1] = normalizedY;
      }
    }

    const indexCount = chunk.cellsX * chunk.cellsY * 6;
    const indices = vertexCount > 65535
      ? new Uint32Array(indexCount)
      : new Uint16Array(indexCount);

    let indexOffset = 0;

    for (let y = 0; y < chunk.height - 1; y++) {
      for (let x = 0; x < chunk.width - 1; x++) {
        const a = y * chunk.width + x;
        const b = a + 1;
        const c = (y + 1) * chunk.width + x;
        const d = c + 1;

        indices[indexOffset++] = a;
        indices[indexOffset++] = b;
        indices[indexOffset++] = c;

        indices[indexOffset++] = b;
        indices[indexOffset++] = d;
        indices[indexOffset++] = c;
      }
    }

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    );

    geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(uvs, 2),
    );

    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = `terrain_chunk_${chunk.startSampleX}_${chunk.startSampleY}`;

    return mesh;
  }

  private disposeObject(object: THREE.Object3D): void {
    for (const child of object.children) {
      this.disposeObject(child);
    }

    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
    }
  }
}