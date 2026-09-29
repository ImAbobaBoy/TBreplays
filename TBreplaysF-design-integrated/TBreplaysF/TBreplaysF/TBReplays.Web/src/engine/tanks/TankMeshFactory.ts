import * as THREE from 'three';

import type {
  ManualTankModel,
  TankVisualKey,
} from '../../domain/TankModels';

export type TankVisual = {
  root: THREE.Group;
  turretPivot: THREE.Group;
  muzzleSocket: THREE.Object3D;
  labelSprite: THREE.Sprite;
  selectionRing: THREE.Mesh;
};

type TankDimensions = {
  bodyWidth: number;
  bodyHeight: number;
  bodyLength: number;
  turretWidth: number;
  turretHeight: number;
  turretLength: number;
  gunLength: number;
};

const dimensionsByVisualKey: Record<TankVisualKey, TankDimensions> = {
  light: {
    bodyWidth: 5.6,
    bodyHeight: 1.8,
    bodyLength: 7.2,
    turretWidth: 3.6,
    turretHeight: 1.2,
    turretLength: 3.4,
    gunLength: 5.2,
  },
  medium: {
    bodyWidth: 6.4,
    bodyHeight: 2.1,
    bodyLength: 8.4,
    turretWidth: 4.2,
    turretHeight: 1.45,
    turretLength: 4.0,
    gunLength: 6.2,
  },
  heavy: {
    bodyWidth: 7.4,
    bodyHeight: 2.5,
    bodyLength: 9.7,
    turretWidth: 4.9,
    turretHeight: 1.75,
    turretLength: 4.8,
    gunLength: 6.8,
  },
  td: {
    bodyWidth: 7.0,
    bodyHeight: 2.1,
    bodyLength: 9.8,
    turretWidth: 4.8,
    turretHeight: 1.25,
    turretLength: 3.8,
    gunLength: 7.4,
  },
};

export function createTankVisual(model: ManualTankModel): TankVisual {
  const dimensions = dimensionsByVisualKey[model.visualKey];
  const root = new THREE.Group();

  root.name = `manual_tank_${model.id}`;
  root.userData.kind = 'manualTank';
  root.userData.manualTankId = model.id;

  // TODO: Временное MVP-решение.
  // Сейчас танки собраны из простых primitive meshes, чтобы быстро получить постановку, drag, yaw корпуса и yaw башни.
  // Потом заменить на реальные/условные модели танков по visualKey или vehicleCompactDescriptor.
  // Убрать primitive-геометрию, когда появится asset pipeline для tank models.
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(model.color),
    roughness: 0.82,
    metalness: 0.08,
  });

  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.9,
    metalness: 0.12,
  });

  const selectionMaterial = new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(
      dimensions.bodyWidth,
      dimensions.bodyHeight,
      dimensions.bodyLength,
    ),
    bodyMaterial,
  );

  body.name = 'manual_tank_body';
  body.position.y = dimensions.bodyHeight / 2;
  root.add(body);

  const turretPivot = new THREE.Group();
  turretPivot.name = 'manual_tank_turret_pivot';
  turretPivot.position.y = dimensions.bodyHeight + 0.65;
  turretPivot.position.z = dimensions.bodyLength * 0.08;
  root.add(turretPivot);

  const turret = new THREE.Mesh(
    new THREE.BoxGeometry(
      dimensions.turretWidth,
      dimensions.turretHeight,
      dimensions.turretLength,
    ),
    darkMaterial,
  );

  turret.name = 'manual_tank_turret';
  turret.position.y = dimensions.turretHeight / 2;
  turretPivot.add(turret);

  const gun = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.24, dimensions.gunLength, 12),
    darkMaterial,
  );

  gun.name = 'manual_tank_gun';
  gun.rotation.x = Math.PI / 2;
  gun.position.y = dimensions.turretHeight / 2;
  gun.position.z = dimensions.turretLength / 2 + dimensions.gunLength / 2;
  turretPivot.add(gun);

  const muzzleSocket = new THREE.Object3D();
  muzzleSocket.name = 'manual_tank_muzzle_socket';
  muzzleSocket.position.set(
    0,
    dimensions.turretHeight / 2,
    dimensions.turretLength / 2 + dimensions.gunLength,
  );
  turretPivot.add(muzzleSocket);

  const directionMarker = new THREE.Mesh(
    new THREE.ConeGeometry(0.75, 1.8, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );

  directionMarker.name = 'manual_tank_direction_marker';
  directionMarker.rotation.x = Math.PI / 2;
  directionMarker.position.y = dimensions.bodyHeight + 0.25;
  directionMarker.position.z = dimensions.bodyLength / 2 + 0.7;
  root.add(directionMarker);

  const selectionRing = new THREE.Mesh(
    new THREE.RingGeometry(
      Math.max(dimensions.bodyWidth, dimensions.bodyLength) * 0.58,
      Math.max(dimensions.bodyWidth, dimensions.bodyLength) * 0.68,
      48,
    ),
    selectionMaterial,
  );

  selectionRing.name = 'manual_tank_selection_ring';
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.position.y = 0.08;
  selectionRing.renderOrder = 900;
  selectionRing.visible = false;
  root.add(selectionRing);

  const labelSprite = createTankLabelSprite(model.label);
  labelSprite.position.y = dimensions.bodyHeight + 6.4;
  root.add(labelSprite);

  markTankChildren(root, model.id);
  applyTankModelToVisual(model, {
    root,
    turretPivot,
    muzzleSocket,
    labelSprite,
    selectionRing,
  });

  return {
    root,
    turretPivot,
    muzzleSocket,
    labelSprite,
    selectionRing,
  };
}

export function applyTankModelToVisual(
  model: ManualTankModel,
  visual: TankVisual,
): void {
  visual.root.position.set(
    model.pose.x,
    model.pose.y,
    model.pose.z,
  );

  visual.root.rotation.y = THREE.MathUtils.degToRad(model.pose.bodyYawDegrees);
  visual.turretPivot.rotation.y = THREE.MathUtils.degToRad(model.pose.turretYawDegrees);
  updateTankLabel(visual, model.label);
}

export function setTankSelected(
  visual: TankVisual,
  selected: boolean,
): void {
  visual.selectionRing.visible = selected;
}

export function getTankMuzzleWorldPosition(visual: TankVisual): THREE.Vector3 {
  const position = new THREE.Vector3();
  visual.muzzleSocket.getWorldPosition(position);

  return position;
}

export function updateTankLabel(
  visual: TankVisual,
  label: string,
): void {
  const material = visual.labelSprite.material as THREE.SpriteMaterial;

  if (material.map) {
    material.map.dispose();
  }

  material.map = createTextTexture(label || 'Танк');
  material.needsUpdate = true;
}

export function disposeTankVisual(visual: TankVisual): void {
  disposeObject(visual.root);
}

function createTankLabelSprite(label: string): THREE.Sprite {
  const texture = createTextTexture(label || 'Танк');

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });

  const sprite = new THREE.Sprite(material);
  sprite.name = 'manual_tank_label';
  sprite.scale.set(16, 5, 1);
  sprite.renderOrder = 1000;

  return sprite;
}

function createTextTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Не удалось создать canvas context для tank label.');
  }

  context.clearRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = 'rgba(15, 23, 42, 0.82)';
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = 'rgba(255, 255, 255, 0.88)';
  context.lineWidth = 8;
  context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

  context.fillStyle = '#ffffff';
  context.font = 'bold 44px Arial';
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const lines = text.split('\n').slice(0, 2);

  for (let i = 0; i < lines.length; i++) {
    context.fillText(
      lines[i],
      canvas.width / 2,
      canvas.height / 2 - 28 + i * 54,
    );
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  return texture;
}

function markTankChildren(
  object: THREE.Object3D,
  tankId: string,
): void {
  object.userData.kind = 'manualTank';
  object.userData.manualTankId = tankId;

  for (const child of object.children) {
    markTankChildren(child, tankId);
  }
}

function disposeObject(object: THREE.Object3D): void {
  for (const child of object.children) {
    disposeObject(child);
  }

  if (
    object instanceof THREE.Mesh ||
    object instanceof THREE.Line ||
    object instanceof THREE.Sprite
  ) {
    if ('geometry' in object && object.geometry) {
      object.geometry.dispose();
    }

    if (Array.isArray(object.material)) {
      for (const material of object.material) {
        disposeMaterial(material);
      }
    } else {
      disposeMaterial(object.material);
    }
  }
}

function disposeMaterial(material: THREE.Material): void {
  if (material instanceof THREE.SpriteMaterial && material.map) {
    material.map.dispose();
  }

  material.dispose();
}