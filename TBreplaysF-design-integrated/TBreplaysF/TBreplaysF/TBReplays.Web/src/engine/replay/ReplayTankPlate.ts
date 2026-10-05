import * as THREE from 'three';

function frame(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, enemy: boolean): void {
  const skew = Math.min(height * 2 / 9, width / 2);
  ctx.beginPath();
  ctx.moveTo(x + (enemy ? skew : 0), y);
  ctx.lineTo(x + width - (enemy ? 0 : skew), y);
  ctx.lineTo(x + width - (enemy ? skew : 0), y + height);
  ctx.lineTo(x + (enemy ? 0 : skew), y + height);
  ctx.closePath();
}

function sportsFill(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, enemy: boolean): void {
  const color = ctx.createLinearGradient(0,y,0,y+height);
  color.addColorStop(0,enemy?'#ff3965':'#4880ff');
  color.addColorStop(.28,enemy?'#ff174b':'#2868ff');
  color.addColorStop(.72,enemy?'#ed1645':'#2560ec');
  color.addColorStop(1,enemy?'#be1239':'#1f4ec5');
  ctx.fillStyle=color; ctx.fillRect(x,y,width,height);
  ctx.lineWidth=1;
  for(const [direction,stroke] of [[1,'#ffffff09'],[-1,'#0000000d']] as const) {
    ctx.strokeStyle=stroke;ctx.beginPath();
    for(let offset=-height;offset<width+height;offset+=16) {
      ctx.moveTo(x+offset,y);ctx.lineTo(x+offset+direction*height,y+height);
    }
    ctx.stroke();
  }
  const shine=ctx.createLinearGradient(x,y,x+width*.25,y+height);
  shine.addColorStop(0,'#ffffff20'); shine.addColorStop(.48,'#ffffff00');
  ctx.fillStyle=shine;ctx.fillRect(x,y,width,height);
  ctx.fillStyle='#ffffff75';ctx.fillRect(x,y,width,1);
}

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
        if (vMapUv.y >= .0875 && vMapUv.y <= .1375 && vMapUv.x >= .078125 && vMapUv.x <= .921875
            && vMapUv.x <= .078125 + .84375 * plateReload) diffuseColor = vec4(1.0);
        #endif`);
    };
    material.customProgramCacheKey = () => 'replay-tank-plate-v2';
    material.needsUpdate = true;
    sprite.userData.replayPlate = { canvas, fill, signature: '' };
    sprite.scale.set(22, 6.875, 1);
  }
  const plate = sprite.userData.replayPlate as { canvas: HTMLCanvasElement; fill: { value: number }; signature: string };
  plate.fill.value = reload ?? 0;
  sprite.visible = true;
  const signature = JSON.stringify(['v5', name, tank, health, maximum, lastKnown, enemy]);
  if (signature === plate.signature) return;
  plate.signature = signature;
  const ctx = plate.canvas.getContext('2d');
  if (!ctx) return;
  const fraction = maximum && health != null ? THREE.MathUtils.clamp(health / maximum, 0, 1) : 0;
  ctx.clearRect(0,0,512,160);
  const background = ctx.createLinearGradient(0,0,0,160);
  background.addColorStop(0,'#343a42'); background.addColorStop(1,'#252a30');
  ctx.fillStyle = background; frame(ctx,2,2,508,156,enemy); ctx.fill();
  ctx.strokeStyle = '#ffffff38'; ctx.lineWidth = 2; ctx.stroke();
  ctx.font = '20px Arial';
  const tankWidth = Math.min(168, ctx.measureText(tank).width);
  const divider = 472 - tankWidth - 12;
  ctx.fillStyle = '#f5faff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = 'bold 24px Arial';
  ctx.fillText(name,40,31,Math.max(1,divider - 56));
  if (tank) { ctx.fillStyle = enemy ? '#dfbcc0' : '#b7cedf'; ctx.fillRect(divider,17,1,28); }
  ctx.textAlign = 'right'; ctx.font = '20px Arial'; ctx.fillStyle = '#f5faff'; ctx.fillText(tank,472,31,168);
  ctx.fillStyle = '#1c2026'; frame(ctx,24,58,464,69,enemy); ctx.fill();
  ctx.save(); frame(ctx,24,55,464,72,enemy); ctx.clip();
  if(fraction > 0) {
    frame(ctx,24,55,464*fraction,69,enemy);ctx.clip();
    sportsFill(ctx,24,55,464*fraction,69,enemy);
  }
  ctx.restore();
  ctx.textAlign = 'center'; ctx.font = 'bold 29px Arial'; ctx.fillStyle = '#fff';
  ctx.fillText(`${lastKnown?'≈ ':''}${health == null?'?':Math.round(health)}/${maximum ?? '?'}`,256,94,440);
  ctx.fillStyle = '#ffffff18'; ctx.fillRect(40,138,432,8);
  material.map!.needsUpdate = true;
}
