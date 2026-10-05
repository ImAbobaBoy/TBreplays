import * as THREE from 'three';

/** One reusable canvas per tank. Reload fill is a shader uniform, not a per-frame texture upload. */
export function updateReplayTankPlate(sprite: THREE.Sprite, name: string, tank: string,
  health: number | null, maximum: number | null, lastKnown: boolean, reload: number | null, enemy = false): void {
  const material = sprite.material as THREE.SpriteMaterial;
  if (!sprite.userData.replayPlate) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 160;
    material.map?.dispose();
    material.map = new THREE.CanvasTexture(canvas);
    material.map.colorSpace = THREE.SRGBColorSpace;
    const fill = { value: 0 };
    material.onBeforeCompile = shader => {
      shader.uniforms.plateReload = fill;
      shader.fragmentShader = 'uniform float plateReload;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
        if (vMapUv.y >= .0875 && vMapUv.y <= .1375 && vMapUv.x >= .046875 && vMapUv.x <= .953125
            && vMapUv.x <= .046875 + .90625 * plateReload) diffuseColor = vec4(1.0);
        #endif`);
    };
    material.customProgramCacheKey = () => 'replay-tank-plate-v1';
    material.needsUpdate = true;
    sprite.userData.replayPlate = { canvas, fill, signature: '' };
    sprite.scale.set(22, 6.875, 1);
  }
  const plate = sprite.userData.replayPlate as { canvas: HTMLCanvasElement; fill: { value: number }; signature: string };
  plate.fill.value = reload ?? 0;
  sprite.visible = true;
  const signature = JSON.stringify(['v3', name, tank, health, maximum, lastKnown, enemy]);
  if (signature === plate.signature) return;
  plate.signature = signature;
  const ctx = plate.canvas.getContext('2d');
  if (!ctx) return;
  const fraction = maximum && health != null ? THREE.MathUtils.clamp(health / maximum, 0, 1) : 0;
  ctx.clearRect(0,0,512,160);
  const background = ctx.createLinearGradient(0,0,0,160);
  background.addColorStop(0,enemy ? '#48282d' : '#24394a'); background.addColorStop(1,enemy ? '#281116' : '#101c28');
  ctx.fillStyle = background; ctx.beginPath(); ctx.roundRect(2,2,508,156,14); ctx.fill();
  ctx.strokeStyle = enemy ? '#d7a9aa' : '#a8c6db'; ctx.lineWidth = 2; ctx.stroke();
  ctx.font = '20px Arial';
  const tankWidth = Math.min(168, ctx.measureText(tank).width);
  const divider = 488 - tankWidth - 12;
  ctx.fillStyle = '#f5faff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = 'bold 24px Arial';
  ctx.fillText(name,24,31,Math.max(1,divider - 40));
  if (tank) { ctx.fillStyle = enemy ? '#dfbcc0' : '#b7cedf'; ctx.fillRect(divider,17,1,28); }
  ctx.textAlign = 'right'; ctx.font = '20px Arial'; ctx.fillStyle = '#f5faff'; ctx.fillText(tank,488,31,168);
  ctx.fillStyle = enemy ? '#321c23' : '#1d2b38'; ctx.beginPath(); ctx.roundRect(24,58,464,69,10); ctx.fill();
  ctx.save(); ctx.clip();
  const hp = ctx.createLinearGradient(0,58,0,127); hp.addColorStop(0,enemy ? '#ff6269' : '#469dff'); hp.addColorStop(1,enemy ? '#94202e' : '#12518b');
  ctx.fillStyle = hp;
  const edge = 24 + 464 * fraction;
  ctx.beginPath(); ctx.moveTo(24,58); ctx.lineTo(edge,58);
  ctx.lineTo(fraction === 1 ? edge : Math.max(24,edge - 22),127); ctx.lineTo(24,127); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.roundRect(24,58,464,69,10);
  ctx.strokeStyle = enemy ? '#ad747c' : '#6e91ab'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.textAlign = 'center'; ctx.font = 'bold 29px Arial'; ctx.fillStyle = '#fff';
  ctx.fillText(`${lastKnown?'≈ ':''}${health == null?'?':Math.round(health)}/${maximum ?? '?'}`,256,94,440);
  ctx.fillStyle = enemy ? '#46282d' : '#263845'; ctx.fillRect(24,138,464,8);
  material.map!.needsUpdate = true;
}
