import './style.css';

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DDSLoader } from 'three/examples/jsm/loaders/DDSLoader.js';

type TerrainBounds = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  width: number;
  depth: number;
  height: number;
};

type TerrainChunkInfo = {
  x: number;
  y: number;
  startSampleX: number;
  startSampleY: number;
  width: number;
  height: number;
  cellsX: number;
  cellsY: number;
  url: string;
};

type MapManifest = {
  mapId: string;
  heightmapSize: number;
  heightmapTileSize: number;
  chunkCellSize: number;
  chunksX: number;
  chunksY: number;
  bounds: TerrainBounds;
  chunks: TerrainChunkInfo[];
};

type TerrainTextureManifest = {
  mapId: string;
  fileName: string;
  sizeBytes: number;
  url: string;
};

type MapObjectMeshManifest = {
  mapId: string;
  vertexCount: number;
  indexCount: number;
  url: string;
};

type TerrainChunkData = {
  width: number;
  height: number;
  startSampleX: number;
  startSampleY: number;
  cellsX: number;
  cellsY: number;
  heights: Uint16Array;
};

type ReplayMovementSample = {
  time: number;
  segmentIndex: number;
  x: number;
  y: number;
  z: number;
  yawRad: number;
  yawDeg: number;
};

type ReplayMovementTrack = {
  entityId: number;
  entityHex: string;
  teamId: number;
  nickname: string;
  vehicleCompactDescriptor: number;
  samplesCount: number;
  firstTime: number;
  lastTime: number;
  samples: ReplayMovementSample[];
};

type ReplayMovementSet = {
  replayId: string;
  mapName: string | null;
  mapId: number | null;
  battleDuration: number | null;
  trackCount: number;
  sampleCount: number;
  tracks: ReplayMovementTrack[];
};

type ReplayImportResult = {
  replayId: string;
  mapName: string | null;
  mapId: number | null;
  trackCount: number;
  sampleCount: number;
  movementsUrl: string;
};

type ReplayPose = {
  x: number;
  y: number;
  z: number;
  yawRad: number;
};

type TankInstance = {
  entityId: number;
  entityHex: string;
  group: THREE.Group;
  turretPivot: THREE.Group;
  hpSprite: THREE.Sprite;
  track: ReplayMovementTrack;
  turretFrames: ParsedReplayTurretFrame[];
  healthFrames: ParsedReplayHealthFrame[];
  maxHealth: number;
  lastRenderedHealth: number | null;
};

type MapObjectVector3 = {
  x: number;
  y: number;
  z: number;
};

type MapObjectQuaternion = {
  x: number;
  y: number;
  z: number;
  w: number;
};

type MapObjectDto = {
  id: number;
  name: string;
  type: string;
  position: MapObjectVector3;
  rotation: MapObjectQuaternion;
  scale: MapObjectVector3;
  localBoundsMin: MapObjectVector3;
  localBoundsMax: MapObjectVector3;
  localCenter: MapObjectVector3;
  localSize: MapObjectVector3;
  renderBatchCount: number;
};

type MapObjectSet = {
  mapId: string;
  count: number;
  objects: MapObjectDto[];
};

type ReplayVehicleInfo = {
  entityId: number;
  accountId: number;
  nickname: string;
  teamId: number;
  vehicleCompactDescriptor: number;
};

type ParsedReplayMovementFrame = {
  time: number;
  entityId: number;
  teamId: number;
  segmentIndex: number;

  x: number;
  y: number;
  z: number;

  yawRadians: number;
  pitchRadians: number;
  rollRadians: number;

  isVolatile: boolean;
};

type ParsedReplayTurretFrame = {
  time: number;
  entityId: number;
  turretYawRadians: number;
};

type ParsedReplayHealthFrame = {
  time: number;
  entityId: number;
  health: number;
};

type ReplayParseResult = {
  vehicles: ReplayVehicleInfo[];
  movementFrames: ParsedReplayMovementFrame[];
  turretFrames: ParsedReplayTurretFrame[];
  shotEvents: unknown[];
  projectilePoints: unknown[];
  healthFrames: ParsedReplayHealthFrame[];
};

type ReplayParseLocalResult = {
  replayId: string;
  vehicleCount: number;
  movementFrameCount: number;
  turretFrameCount: number;
  shotEventCount: number;
  projectilePointCount: number;
  healthFrameCount: number;
  parseResultUrl: string;
};

const apiBase = import.meta.env.VITE_API_BASE as string;
const ddsLoader = new DDSLoader();

const viewer = document.querySelector<HTMLDivElement>('#viewer');
const mapIdInput = document.querySelector<HTMLInputElement>('#mapIdInput');
const loadButton = document.querySelector<HTMLButtonElement>('#loadButton');

const replayIdInput = document.querySelector<HTMLInputElement>('#replayIdInput');
const importReplayButton = document.querySelector<HTMLButtonElement>('#importReplayButton');
const loadReplayButton = document.querySelector<HTMLButtonElement>('#loadReplayButton');
const playReplayButton = document.querySelector<HTMLButtonElement>('#playReplayButton');
const replayTimeSlider = document.querySelector<HTMLInputElement>('#replayTimeSlider');
const replayTimeLabel = document.querySelector<HTMLDivElement>('#replayTimeLabel');

const statusElement = document.querySelector<HTMLDivElement>('#status');

if (
  !viewer ||
  !mapIdInput ||
  !loadButton ||
  !replayIdInput ||
  !importReplayButton ||
  !loadReplayButton ||
  !playReplayButton ||
  !replayTimeSlider ||
  !replayTimeLabel ||
  !statusElement
) {
  throw new Error('HTML разметка повреждена.');
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101418);

const camera = new THREE.PerspectiveCamera(
  60,
  viewer.clientWidth / viewer.clientHeight,
  0.1,
  5000,
);

camera.position.set(0, 420, 620);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
});

renderer.setSize(viewer.clientWidth, viewer.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 20, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.48;
controls.update();

const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
sunLight.position.set(-250, 600, 300);
scene.add(sunLight);

const axesHelper = new THREE.AxesHelper(220);
scene.add(axesHelper);

const gridHelper = new THREE.GridHelper(800, 40, 0x334155, 0x1e293b);
scene.add(gridHelper);

const debugCube = new THREE.Mesh(
  new THREE.BoxGeometry(10, 10, 10),
  new THREE.MeshBasicMaterial({ color: 0xff0000 }),
);

debugCube.position.set(0, 5, 0);
debugCube.name = 'debug_origin_cube';
scene.add(debugCube);

const terrainGroup = new THREE.Group();
terrainGroup.name = 'terrain';
scene.add(terrainGroup);

const realObjectsGroup = new THREE.Group();
realObjectsGroup.name = 'real_map_objects';

// Регулировка высоты настоящих объектов относительно terrain.
// Если объекты висят в воздухе — ставь отрицательное значение.
realObjectsGroup.position.y = 0.75;

scene.add(realObjectsGroup);

const replayGroup = new THREE.Group();
replayGroup.name = 'replay';
scene.add(replayGroup);

const tankInstances = new Map<number, TankInstance>();

let currentReplay: ReplayMovementSet | null = null;
let currentReplayTime = 0;
let replayMinTime = 0;
let replayMaxTime = 0;
let replayPlaybackStartedAtMs = 0;
let isReplayPlaying = false;

const replayTransform = {
  flipZ: true,
  yawSign: -1,
  yawOffset: 0,
  turretYawSign: -1,
  turretYawOffset: 0,
  heightOffset: 2.2,
};

const terrainMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.95,
  metalness: 0.0,
  side: THREE.DoubleSide,
});
const realObjectMaterial = new THREE.MeshStandardMaterial({
  color: 0xb08968,
  roughness: 0.88,
  metalness: 0.0,
  side: THREE.DoubleSide,
});

const objectProxyMaterial = new THREE.MeshStandardMaterial({
  color: 0xb08968,
  roughness: 0.9,
  metalness: 0.0,
  transparent: true,
  opacity: 0.42,
  side: THREE.DoubleSide,
});

const objectEdgeMaterial = new THREE.LineBasicMaterial({
  color: 0xf8fafc,
  transparent: true,
  opacity: 0.38,
});

loadButton.addEventListener('click', async () => {
  const mapId = mapIdInput.value.trim();

  if (!mapId) {
    setStatus('Вставь mapId из ответа import-local.');
    return;
  }

  await loadMap(mapId);
});

importReplayButton.addEventListener('click', async () => {
  await importLocalReplay();
});

loadReplayButton.addEventListener('click', async () => {
  const replayId = replayIdInput.value.trim();

  if (!replayId) {
    setStatus('Сначала импортируй replay или вставь replayId.');
    return;
  }

  await loadReplayMovements(replayId);
});

playReplayButton.addEventListener('click', () => {
  toggleReplayPlayback();
});

replayTimeSlider.addEventListener('input', () => {
  pauseReplay();

  currentReplayTime = Number(replayTimeSlider.value);

  updateTanksAtTime(currentReplayTime);
  updateReplayTimeUi();
});

window.addEventListener('resize', () => {
  camera.aspect = viewer.clientWidth / viewer.clientHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(viewer.clientWidth, viewer.clientHeight);
});

renderer.setAnimationLoop((timestamp) => {
  updateReplayPlayback(timestamp);

  controls.update();
  renderer.render(scene, camera);
});

async function loadMap(mapId: string): Promise<void> {
  try {
    loadButton.disabled = true;
    setStatus('Загружаю manifest...');

    clearTerrain();

    const manifest = await fetchManifest(mapId);

    setStatus(
      `Manifest: heightmap ${manifest.heightmapSize}, chunks ${manifest.chunksX}x${manifest.chunksY}`,
    );

    validateManifest(manifest);

    await loadTerrainTexture(manifest.mapId);
    await loadTerrainChunks(manifest);
    await loadRealObjectMesh(manifest.mapId);

    focusCameraOnObject(terrainGroup);

    setStatus(
      `Карта загружена: ${manifest.mapId}, чанков: ${manifest.chunks.length}, real objects: ${realObjectsGroup.children.length}`,
    );
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : 'Неизвестная ошибка загрузки.');
  } finally {
    loadButton.disabled = false;
  }
}

async function fetchManifest(mapId: string): Promise<MapManifest> {
  const response = await fetch(`${apiBase}/api/maps/${mapId}/manifest`);

  if (!response.ok) {
    throw new Error(`Manifest не загрузился. HTTP ${response.status}`);
  }

  return await response.json() as MapManifest;
}

async function fetchTerrainChunk(chunkUrl: string): Promise<TerrainChunkData> {
  const response = await fetch(`${apiBase}${chunkUrl}`);

  if (!response.ok) {
    throw new Error(`Чанк не загрузился. HTTP ${response.status}: ${chunkUrl}`);
  }

  const buffer = await response.arrayBuffer();

  return parseTerrainChunk(buffer);
}

function parseTerrainChunk(buffer: ArrayBuffer): TerrainChunkData {
  const headerSize = 24;

  if (buffer.byteLength < headerSize) {
    throw new Error('Файл чанка слишком маленький.');
  }

  const view = new DataView(buffer);

  const width = view.getInt32(0, true);
  const height = view.getInt32(4, true);
  const startSampleX = view.getInt32(8, true);
  const startSampleY = view.getInt32(12, true);
  const cellsX = view.getInt32(16, true);
  const cellsY = view.getInt32(20, true);

  if (width <= 0 || height <= 0) {
    throw new Error(`Некорректный размер чанка: ${width}x${height}`);
  }

  const expectedLength = headerSize + width * height * 2;

  if (buffer.byteLength !== expectedLength) {
    throw new Error(
      `Некорректный размер chunk binary. Ожидалось ${expectedLength}, получено ${buffer.byteLength}.`,
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

async function loadTerrainChunks(manifest: MapManifest): Promise<void> {
  const concurrency = 8;
  let loaded = 0;

  await runWithConcurrency(manifest.chunks, concurrency, async (chunkInfo) => {
    const chunkData = await fetchTerrainChunk(chunkInfo.url);
    const mesh = createTerrainChunkMesh(manifest, chunkData);

    terrainGroup.add(mesh);

    loaded++;

    if (loaded % 8 === 0 || loaded === manifest.chunks.length) {
      setStatus(`Загружено чанков: ${loaded}/${manifest.chunks.length}`);
    }
  });
}

function createTerrainChunkMesh(
  manifest: MapManifest,
  chunk: TerrainChunkData,
): THREE.Group {
  const vertexCount = chunk.width * chunk.height;

  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let y = 0; y < chunk.height; y++) {
    for (let x = 0; x < chunk.width; x++) {
      const vertexIndex = y * chunk.width + x;
      const heightIndex = vertexIndex;

      const sampleX = chunk.startSampleX + x;
      const sampleY = chunk.startSampleY + y;

      const normalizedX = sampleX / (manifest.heightmapSize - 1);
      const normalizedY = sampleY / (manifest.heightmapSize - 1);

      const rawHeight = chunk.heights[heightIndex];
      const normalizedHeight = rawHeight / 65535;

      const worldX = manifest.bounds.minX + normalizedX * manifest.bounds.width;
      const worldHeight = manifest.bounds.minZ + normalizedHeight * manifest.bounds.height;
      const worldDepth = manifest.bounds.maxY - normalizedY * manifest.bounds.depth;

      const positionOffset = vertexIndex * 3;
      positions[positionOffset] = worldX;
      positions[positionOffset + 1] = worldHeight;
      positions[positionOffset + 2] = worldDepth;

      const uvOffset = vertexIndex * 2;
      uvs[uvOffset] =  1 - normalizedX;
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

  const surface = new THREE.Mesh(geometry, terrainMaterial);
  surface.name = `terrain_chunk_${chunk.startSampleX}_${chunk.startSampleY}`;

  const group = new THREE.Group();
  group.add(surface);

  return group;
}

async function importLocalReplay(): Promise<void> {
  try {
    importReplayButton.disabled = true;
    setStatus('Импортирую replay...');

    const response = await fetch(`${apiBase}/api/replays/parse-local`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Replay не импортировался. HTTP ${response.status}`);
    }

    const result = await response.json() as ReplayParseLocalResult;

    replayIdInput.value = result.replayId;

    setStatus(
      `Replay распарсен: ${result.replayId}, tanks=${result.vehicleCount}, moves=${result.movementFrameCount}, turret=${result.turretFrameCount}, hp=${result.healthFrameCount}`,
    );
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : 'Неизвестная ошибка импорта replay.');
  } finally {
    importReplayButton.disabled = false;
  }
}

async function loadReplayMovements(replayId: string): Promise<void> {
  try {
    loadReplayButton.disabled = true;
    setStatus('Загружаю parse-result replay...');

    clearReplay();

    const response = await fetch(`${apiBase}/api/replays/${replayId}/parse-result`);

    if (!response.ok) {
      throw new Error(`Parse-result replay не загрузился. HTTP ${response.status}`);
    }

    const parseResult = await response.json() as ReplayParseResult;
    const movementSet = buildMovementSetFromParseResult(replayId, parseResult);

    currentReplay = movementSet;
    tankInstances.clear();

    replayMinTime = Math.min(...movementSet.tracks.map((track) => track.firstTime));
    replayMaxTime = Math.max(...movementSet.tracks.map((track) => track.lastTime));
    currentReplayTime = replayMinTime;

    replayTimeSlider.min = replayMinTime.toString();
    replayTimeSlider.max = replayMaxTime.toString();
    replayTimeSlider.step = '0.05';
    replayTimeSlider.value = currentReplayTime.toString();

    const turretFramesByEntityId = groupByEntityId(parseResult.turretFrames);
    const healthFramesByEntityId = groupByEntityId(parseResult.healthFrames);

    for (let i = 0; i < movementSet.tracks.length; i++) {
      const track = movementSet.tracks[i];
      const color = getTeamColor(track.teamId, i);

      const path = createMovementPath(track, color);
      replayGroup.add(path);

      const turretFrames = turretFramesByEntityId.get(track.entityId) ?? [];
      const healthFrames = healthFramesByEntityId.get(track.entityId) ?? [];

      const tank = createTankInstance(
        track,
        color,
        turretFrames,
        healthFrames);

      tankInstances.set(track.entityId, tank);
      replayGroup.add(tank.group);
    }

    updateTanksAtTime(currentReplayTime);
    updateReplayTimeUi();

    setStatus(
      `Танки загружены: tanks=${movementSet.tracks.length}, moves=${parseResult.movementFrames.length}, turret=${parseResult.turretFrames.length}, hp=${parseResult.healthFrames.length}`,
    );
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : 'Неизвестная ошибка загрузки replay.');
  } finally {
    loadReplayButton.disabled = false;
  }
}

function buildMovementSetFromParseResult(
  replayId: string,
  parseResult: ReplayParseResult,
): ReplayMovementSet {
  const vehiclesByEntityId = new Map<number, ReplayVehicleInfo>();

  for (const vehicle of parseResult.vehicles) {
    vehiclesByEntityId.set(vehicle.entityId, vehicle);
  }

  const framesByEntityId = groupByEntityId(parseResult.movementFrames);
  const tracks: ReplayMovementTrack[] = [];

  for (const [entityId, frames] of framesByEntityId) {
    const vehicle = vehiclesByEntityId.get(entityId);

    if (!vehicle) {
      continue;
    }

    const ordered = [...frames].sort((a, b) => a.time - b.time);

    if (ordered.length === 0) {
      continue;
    }

    const samples: ReplayMovementSample[] = ordered.map((frame) => ({
      time: frame.time,
      segmentIndex: frame.segmentIndex,
      x: frame.x,
      y: frame.y,
      z: frame.z,
      yawRad: frame.yawRadians,
      yawDeg: frame.yawRadians * 180 / Math.PI,
    }));

    tracks.push({
      entityId,
      entityHex: `0x${entityId.toString(16)}`,
      teamId: vehicle.teamId,
      nickname: vehicle.nickname,
      vehicleCompactDescriptor: vehicle.vehicleCompactDescriptor,
      samplesCount: samples.length,
      firstTime: samples[0].time,
      lastTime: samples[samples.length - 1].time,
      samples,
    });
  }

  tracks.sort((a, b) => a.teamId - b.teamId || a.entityId - b.entityId);

  return {
    replayId,
    mapName: null,
    mapId: null,
    battleDuration: null,
    trackCount: tracks.length,
    sampleCount: tracks.reduce((sum, track) => sum + track.samplesCount, 0),
    tracks,
  };
}

function groupByEntityId<T extends { entityId: number }>(
  items: T[],
): Map<number, T[]> {
  const result = new Map<number, T[]>();

  for (const item of items) {
    let group = result.get(item.entityId);

    if (!group) {
      group = [];
      result.set(item.entityId, group);
    }

    group.push(item);
  }

  for (const group of result.values()) {
    group.sort((a, b) => {
      const aTime = 'time' in a ? Number(a.time) : 0;
      const bTime = 'time' in b ? Number(b.time) : 0;

      return aTime - bTime;
    });
  }

  return result;
}

function createMovementPath(
  track: ReplayMovementTrack,
  color: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `replay_track_${track.entityHex}`;

  const samplesBySegment = new Map<number, ReplayMovementSample[]>();

  for (const sample of track.samples) {
    let segment = samplesBySegment.get(sample.segmentIndex);

    if (!segment) {
      segment = [];
      samplesBySegment.set(sample.segmentIndex, segment);
    }

    segment.push(sample);
  }

  for (const [segmentIndex, segmentSamples] of samplesBySegment) {
    if (segmentSamples.length < 2) {
      continue;
    }

    const pathStep = Math.max(1, Math.floor(segmentSamples.length / 300));
    const pathSamples = segmentSamples.filter((_, index) => index % pathStep === 0);

    const positions = new Float32Array(pathSamples.length * 3);

    for (let i = 0; i < pathSamples.length; i++) {
      const sample = pathSamples[i];
      const position = toThreePositionFromReplay(sample);

      const offset = i * 3;

      positions[offset] = position.x;
      positions[offset + 1] = position.y;
      positions[offset + 2] = position.z;
    }

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    );

    geometry.computeBoundingSphere();

    const material = new THREE.LineBasicMaterial({
      color,
    });

    const line = new THREE.Line(geometry, material);
    line.name = `replay_track_${track.entityHex}_segment_${segmentIndex}`;

    group.add(line);
  }

  return group;
}

function createTankInstance(
  track: ReplayMovementTrack,
  color: number,
  turretFrames: ParsedReplayTurretFrame[],
  healthFrames: ParsedReplayHealthFrame[],
): TankInstance {
  const group = new THREE.Group();
  group.name = `tank_${track.entityHex}_${track.nickname}`;

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.05,
  });

  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x1f2937,
    roughness: 0.9,
    metalness: 0.1,
  });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(6.8, 2.2, 9.2),
    bodyMaterial,
  );

  body.position.y = 1.4;
  body.name = 'tank_body';
  group.add(body);

  const turretPivot = new THREE.Group();
  turretPivot.name = 'tank_turret_pivot';
  turretPivot.position.y = 3.0;
  turretPivot.position.z = 0.4;
  group.add(turretPivot);

  const turret = new THREE.Mesh(
    new THREE.BoxGeometry(4.4, 1.5, 4.2),
    darkMaterial,
  );

  turret.name = 'tank_turret';
  turretPivot.add(turret);

  const gun = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.28, 6.4, 10),
    darkMaterial,
  );

  gun.rotation.x = Math.PI / 2;
  gun.position.y = 0.05;
  gun.position.z = 4.8;
  gun.name = 'tank_gun';
  turretPivot.add(gun);

  const directionMarker = new THREE.Mesh(
    new THREE.ConeGeometry(1.2, 2.6, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );

  directionMarker.rotation.x = Math.PI / 2;
  directionMarker.position.y = 2.3;
  directionMarker.position.z = 4.4;
  directionMarker.name = 'tank_direction_marker';
  turretPivot.add(directionMarker);

  const hpSprite = createHpSprite(`${track.nickname || track.entityHex}\nHP ?`);
  hpSprite.position.y = 8.0;
  group.add(hpSprite);

  const maxHealth = healthFrames.length > 0
    ? Math.max(...healthFrames.map((frame) => frame.health))
    : 0;

  const basePose = sampleTrackAtTime(track, track.firstTime);

  if (basePose) {
    applyPoseToTank(group, basePose);
  }

  return {
    entityId: track.entityId,
    entityHex: track.entityHex,
    group,
    turretPivot,
    hpSprite,
    track,
    turretFrames,
    healthFrames,
    maxHealth,
    lastRenderedHealth: null,
  };
}

function updateReplayPlayback(timestamp: number): void {
  if (!isReplayPlaying || !currentReplay) {
    return;
  }

  currentReplayTime = (timestamp - replayPlaybackStartedAtMs) / 1000;

  if (currentReplayTime >= replayMaxTime) {
    currentReplayTime = replayMaxTime;
    pauseReplay();
  }

  updateTanksAtTime(currentReplayTime);
  updateReplayTimeUi();
}

function updateTanksAtTime(time: number): void {
  for (const tank of tankInstances.values()) {
    const pose = sampleTrackAtTime(tank.track, time);

    if (!pose) {
      tank.group.visible = false;
      continue;
    }

    tank.group.visible = true;
    applyPoseToTank(tank.group, pose);

    const turretFrame = findLatestByTime(tank.turretFrames, time);

    if (turretFrame) {
      tank.turretPivot.rotation.y =
        replayTransform.turretYawSign * turretFrame.turretYawRadians
        + replayTransform.turretYawOffset;
    }

    const healthFrame = findLatestByTime(tank.healthFrames, time);

    if (healthFrame && tank.lastRenderedHealth !== healthFrame.health) {
      tank.lastRenderedHealth = healthFrame.health;

      updateHpSprite(
        tank,
        `${tank.track.nickname || tank.entityHex}\nHP ${healthFrame.health}`,
      );
    }
  }
}

function sampleTrackAtTime(
  track: ReplayMovementTrack,
  time: number,
): ReplayPose | null {
  if (track.samples.length === 0) {
    return null;
  }

  if (time < track.firstTime || time > track.lastTime) {
    return null;
  }

  if (time <= track.samples[0].time) {
    return sampleToPose(track.samples[0]);
  }

  const lastSample = track.samples[track.samples.length - 1];

  if (time >= lastSample.time) {
    return sampleToPose(lastSample);
  }

  let left = 0;
  let right = track.samples.length - 1;

  while (right - left > 1) {
    const middle = Math.floor((left + right) / 2);

    if (track.samples[middle].time <= time) {
      left = middle;
    } else {
      right = middle;
    }
  }

  const a = track.samples[left];
  const b = track.samples[right];

  const duration = b.time - a.time;

  if (duration <= 0.0001) {
    return sampleToPose(a);
  }

  const t = (time - a.time) / duration;

  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    yawRad: lerpAngle(a.yawRad, b.yawRad, t),
  };
}

function sampleToPose(sample: ReplayMovementSample): ReplayPose {
  return {
    x: sample.x,
    y: sample.y,
    z: sample.z,
    yawRad: sample.yawRad,
  };
}

function applyPoseToTank(
  tankGroup: THREE.Group,
  pose: ReplayPose,
): void {
  const position = replayPoseToThreePosition(pose);

  tankGroup.position.copy(position);

  tankGroup.rotation.y = replayTransform.yawSign * pose.yawRad
    + replayTransform.yawOffset;
}

function replayPoseToThreePosition(pose: ReplayPose): THREE.Vector3 {
  return new THREE.Vector3(
    pose.x,
    pose.y + replayTransform.heightOffset,
    replayTransform.flipZ ? -pose.z : pose.z,
  );
}

function toThreePositionFromReplay(sample: ReplayMovementSample): THREE.Vector3 {
  return new THREE.Vector3(
    sample.x,
    sample.y + 1.0,
    replayTransform.flipZ ? -sample.z : sample.z,
  );
}

function toggleReplayPlayback(): void {
  if (!currentReplay) {
    setStatus('Сначала загрузи replay.');
    return;
  }

  if (isReplayPlaying) {
    pauseReplay();
    return;
  }

  if (currentReplayTime >= replayMaxTime) {
    currentReplayTime = replayMinTime;
  }

  isReplayPlaying = true;
  replayPlaybackStartedAtMs = performance.now() - currentReplayTime * 1000;
  playReplayButton.textContent = 'Pause';
}

function pauseReplay(): void {
  isReplayPlaying = false;
  playReplayButton.textContent = 'Play';
}

function updateReplayTimeUi(): void {
  replayTimeSlider.value = currentReplayTime.toString();
  replayTimeLabel.textContent = `${currentReplayTime.toFixed(2)} / ${replayMaxTime.toFixed(2)}`;
}

function clearTerrain(): void {
  clearRealObjects();

  for (const child of [...terrainGroup.children]) {
    terrainGroup.remove(child);
    disposeObject(child);
  }
}

function clearReplay(): void {
  pauseReplay();

  currentReplay = null;
  currentReplayTime = 0;
  replayMinTime = 0;
  replayMaxTime = 0;

  tankInstances.clear();

  replayTimeSlider.min = '0';
  replayTimeSlider.max = '1';
  replayTimeSlider.value = '0';
  replayTimeLabel.textContent = '0.00 / 0.00';

  for (const child of [...replayGroup.children]) {
    replayGroup.remove(child);
    disposeObject(child);
  }
}

function disposeObject(object: THREE.Object3D): void {
  if (
    object instanceof THREE.Mesh ||
    object instanceof THREE.Line ||
    object instanceof THREE.LineSegments
  ) {
    object.geometry.dispose();

    if (Array.isArray(object.material)) {
      for (const material of object.material) {
        material.dispose();
      }
    } else {
      object.material.dispose();
    }
  }

  for (const child of object.children) {
    disposeObject(child);
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  action: (item: T) => Promise<void>,
): Promise<void> {
  let currentIndex = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (currentIndex < items.length) {
      const index = currentIndex;
      currentIndex++;

      await action(items[index]);
    }
  });

  await Promise.all(workers);
}

function validateManifest(manifest: MapManifest): void {
  if (!manifest.mapId) {
    throw new Error('Manifest повреждён: mapId пустой.');
  }

  if (manifest.heightmapSize <= 0) {
    throw new Error('Manifest повреждён: heightmapSize <= 0.');
  }

  if (!manifest.bounds) {
    throw new Error('Manifest повреждён: bounds пустой.');
  }

  if (!manifest.chunks?.length) {
    throw new Error('Manifest повреждён: chunks пустой.');
  }
}

function getTeamColor(
  teamId: number,
  index: number,
): number {
  if (teamId === 1) {
    return 0x33ddff;
  }

  if (teamId === 2) {
    return 0xff3344;
  }

  return getTrackColor(index);
}

function getTrackColor(index: number): number {
  const colors = [
    0xff3344,
    0x33ddff,
    0xffcc33,
    0x88ff44,
    0xcc66ff,
    0xff8844,
    0x44ffbb,
    0xffffff,
    0xff66aa,
    0x6699ff,
    0xbbff66,
    0xffdd99,
    0x99ffdd,
    0xdd99ff,
    0xff9999,
    0x99ddff,
  ];

  return colors[index % colors.length];
}

function lerp(
  a: number,
  b: number,
  t: number,
): number {
  return a + (b - a) * t;
}

function lerpAngle(
  a: number,
  b: number,
  t: number,
): number {
  const twoPi = Math.PI * 2;
  let delta = (b - a) % twoPi;

  if (delta > Math.PI) {
    delta -= twoPi;
  }

  if (delta < -Math.PI) {
    delta += twoPi;
  }

  return a + delta * t;
}

function focusCameraOnObject(object: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(object);

  if (box.isEmpty()) {
    console.warn('Нечего фокусировать: bounding box пустой.');
    return;
  }

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();

  box.getCenter(center);
  box.getSize(size);

  const maxSize = Math.max(size.x, size.y, size.z);
  const distance = maxSize * 1.15;

  controls.target.copy(center);

  camera.position.set(
    center.x,
    center.y + distance * 0.75,
    center.z + distance,
  );

  camera.near = 0.1;
  camera.far = Math.max(5000, distance * 5);
  camera.updateProjectionMatrix();

  controls.update();

  console.log('Focused object:', {
    center,
    size,
    cameraPosition: camera.position,
  });
}

async function loadMapObjects(mapId: string): Promise<void> {
  clearMapObjects();

  setStatus('Загружаю объекты карты...');

  const response = await fetch(`${apiBase}/api/maps/${mapId}/objects`);

  if (!response.ok) {
    throw new Error(`Объекты карты не загрузились. HTTP ${response.status}`);
  }

  const objectSet = await response.json() as MapObjectSet;

  for (const mapObject of objectSet.objects) {
    const proxy = createMapObjectProxy(mapObject);

    if (proxy) {
      objectsGroup.add(proxy);
    }
  }

  console.log('Map objects loaded:', {
    mapId: objectSet.mapId,
    count: objectSet.count,
    rendered: objectsGroup.children.length,
  });
}

function createMapObjectProxy(mapObject: MapObjectDto): THREE.Group | null {
  const size = new THREE.Vector3(
    Math.max(0.25, Math.abs(mapObject.localSize.x * mapObject.scale.x)),
    Math.max(0.25, Math.abs(mapObject.localSize.z * mapObject.scale.z)),
    Math.max(0.25, Math.abs(mapObject.localSize.y * mapObject.scale.y)),
  );

  const maxSize = Math.max(size.x, size.y, size.z);

  if (maxSize < 0.35 || maxSize > 220) {
    return null;
  }

  const group = new THREE.Group();
  group.name = `object_${mapObject.id}_${mapObject.name}`;

  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);

  const box = new THREE.Mesh(geometry, objectProxyMaterial);
  box.name = `object_box_${mapObject.id}`;
  group.add(box);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    objectEdgeMaterial,
  );

  edges.name = `object_edges_${mapObject.id}`;
  group.add(edges);

  const yaw = getBlitzYawRad(mapObject.rotation);

  const objectBasePosition = blitzWorldToThree(
    mapObject.position.x,
    mapObject.position.y,
    mapObject.position.z,
  );

  const localCenterOffset = new THREE.Vector3(
    mapObject.localCenter.x * mapObject.scale.x,
    mapObject.localCenter.z * mapObject.scale.z,
    -mapObject.localCenter.y * mapObject.scale.y,
  );

  localCenterOffset.applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    -yaw,
  );

  group.position.copy(objectBasePosition.add(localCenterOffset));
  group.rotation.y = -yaw;

  return group;
}

function getBlitzYawRad(rotation: MapObjectQuaternion): number {
  // Quaternion в Blitz-карте: X/Y — горизонтальная плоскость, Z — вертикальная ось.
  // Для proxy-боксов берём только yaw вокруг вертикали Z.
  const sinyCosp = 2 * (rotation.w * rotation.z + rotation.x * rotation.y);
  const cosyCosp = 1 - 2 * (rotation.y * rotation.y + rotation.z * rotation.z);

  return Math.atan2(sinyCosp, cosyCosp);
}

function blitzWorldToThree(
  x: number,
  y: number,
  z: number,
): THREE.Vector3 {
  // Blitz: X/Y горизонтальная плоскость, Z высота.
  // Three: X/Z горизонтальная плоскость, Y высота.
  // В terrain мы уже использовали ThreeZ = -BlitzY.
  return new THREE.Vector3(
    x,
    z,
    -y,
  );
}

function clearMapObjects(): void {
  for (const child of [...objectsGroup.children]) {
    objectsGroup.remove(child);
    disposeObject(child);
  }
}

async function loadRealObjectMesh(mapId: string): Promise<void> {
  clearRealObjects();

  setStatus('Загружаю реальные объекты карты...');

  const manifestResponse = await fetch(`${apiBase}/api/maps/${mapId}/object-mesh/manifest`);

  if (!manifestResponse.ok) {
    throw new Error(`Manifest реальных объектов не загрузился. HTTP ${manifestResponse.status}`);
  }

  const manifest = await manifestResponse.json() as MapObjectMeshManifest;

  if (manifest.vertexCount <= 0 || manifest.indexCount <= 0) {
    setStatus('Реальные объекты не найдены: mesh пустой.');
    return;
  }

  const meshResponse = await fetch(`${apiBase}${manifest.url}`);

  if (!meshResponse.ok) {
    throw new Error(`Реальные объекты не загрузились. HTTP ${meshResponse.status}`);
  }

  const buffer = await meshResponse.arrayBuffer();
  const mesh = parseRealObjectMesh(buffer);

  realObjectsGroup.add(mesh);

  console.log('Real object mesh loaded:', {
    vertexCount: manifest.vertexCount,
    indexCount: manifest.indexCount,
  });
}

function parseRealObjectMesh(buffer: ArrayBuffer): THREE.Mesh {
  const headerSize = 8;

  if (buffer.byteLength < headerSize) {
    throw new Error('objects_mesh.bin слишком маленький.');
  }

  const view = new DataView(buffer);

  const vertexCount = view.getInt32(0, true);
  const indexCount = view.getInt32(4, true);

  if (vertexCount <= 0 || indexCount <= 0) {
    throw new Error(`Некорректный objects mesh: vertices=${vertexCount}, indices=${indexCount}`);
  }

  const positionsOffset = headerSize;
  const positionsByteLength = vertexCount * 3 * 4;
  const indicesOffset = positionsOffset + positionsByteLength;
  const indicesByteLength = indexCount * 4;

  const expectedLength = headerSize + positionsByteLength + indicesByteLength;

  if (buffer.byteLength !== expectedLength) {
    throw new Error(
      `Некорректный objects_mesh.bin. Ожидалось ${expectedLength}, получено ${buffer.byteLength}.`,
    );
  }

  const positions = new Float32Array(buffer, positionsOffset, vertexCount * 3);
  const indices = new Uint32Array(buffer, indicesOffset, indexCount);

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3),
  );

  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, realObjectMaterial);
  mesh.name = 'real_map_objects_mesh';

  return mesh;
}

function clearRealObjects(): void {
  for (const child of [...realObjectsGroup.children]) {
    realObjectsGroup.remove(child);
    disposeObject(child);
  }
}

function findLatestByTime<T extends { time: number }>(
  frames: T[],
  time: number,
): T | null {
  if (frames.length === 0 || time < frames[0].time) {
    return null;
  }

  let left = 0;
  let right = frames.length - 1;

  while (left < right) {
    const middle = Math.ceil((left + right) / 2);

    if (frames[middle].time <= time) {
      left = middle;
    } else {
      right = middle - 1;
    }
  }

  return frames[left];
}

function createHpSprite(text: string): THREE.Sprite {
  const texture = createTextTexture(text);

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(18, 7, 1);
  sprite.name = 'tank_hp_label';

  return sprite;
}

function updateHpSprite(
  tank: TankInstance,
  text: string,
): void {
  const material = tank.hpSprite.material as THREE.SpriteMaterial;

  if (material.map) {
    material.map.dispose();
  }

  material.map = createTextTexture(text);
  material.needsUpdate = true;
}

function createTextTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Не удалось создать canvas context для HP label.');
  }

  context.clearRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = 'rgba(15, 23, 42, 0.78)';
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  context.lineWidth = 8;
  context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

  context.fillStyle = '#ffffff';
  context.font = 'bold 44px Arial';
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    context.fillText(
      lines[i],
      canvas.width / 2,
      canvas.height / 2 - 32 + i * 58,
    );
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  return texture;
}

async function loadTerrainTexture(mapId: string): Promise<void> {
  setStatus('Загружаю текстуру рельефа...');

  const manifestResponse = await fetch(`${apiBase}/api/maps/${mapId}/terrain/texture/manifest`);

  if (!manifestResponse.ok) {
    console.warn('Terrain texture manifest не загрузился:', manifestResponse.status);
    return;
  }

  const manifest = await manifestResponse.json() as TerrainTextureManifest;

  if (!manifest.url || manifest.sizeBytes <= 0) {
    console.warn('Terrain texture отсутствует для карты:', mapId);
    return;
  }

  const texture = await ddsLoader.loadAsync(`${apiBase}${manifest.url}`);

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  // Поворот только натянутой surface-текстуры.
  // Геометрия рельефа, объекты, танки и треки не вращаются.
  texture.center.set(0.5, 0.5);
  texture.rotation = -Math.PI;

  terrainMaterial.map = texture;
  terrainMaterial.color.set(0xffffff);
  terrainMaterial.needsUpdate = true;

  console.log('Terrain texture loaded:', {
    fileName: manifest.fileName,
    sizeBytes: manifest.sizeBytes,
  });
}

function setStatus(message: string): void {
  statusElement.textContent = message;
}