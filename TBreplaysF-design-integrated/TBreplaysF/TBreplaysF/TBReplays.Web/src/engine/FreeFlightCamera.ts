import * as THREE from 'three';

export type CameraMode = 'orbit' | 'flight';
export const flightSpeeds = [25, 60, 120, 240, 480];

export class FreeFlightCamera {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private enabled = false;
  private keys = new Set<string>();
  private pointer: number | null = null;
  private x = 0;
  private y = 0;
  private speed = 3;
  private readonly velocity = new THREE.Vector3();
  private readonly look = new THREE.Euler(0, 0, 0, 'YXZ');
  private lookPending = false;
  private wheelDistance = 0;
  public onSpeedChanged: ((speed: number) => void) | null = null;

  public constructor(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
    this.camera = camera; this.canvas = canvas;
    canvas.tabIndex = 0;
    canvas.addEventListener('pointerdown', this.down, true);
    canvas.addEventListener('pointermove', this.move, true);
    canvas.addEventListener('pointerup', this.up, true);
    canvas.addEventListener('pointercancel', this.up, true);
    canvas.addEventListener('lostpointercapture', this.endLook);
    canvas.addEventListener('wheel', this.wheel, { passive: false, capture: true });
    canvas.addEventListener('blur', this.canvasBlur);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.reset);
    document.addEventListener('visibilitychange', this.reset);
  }
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled; this.reset();
    this.canvas.classList.toggle('flight-camera', enabled);
    if (enabled) this.canvas.focus({ preventScroll: true });
  }
  public setSpeed(speed: number): void {
    if (!Number.isInteger(speed) || speed < 1 || speed > 5 || speed === this.speed) return;
    this.speed = speed; this.onSpeedChanged?.(speed);
  }
  private readonly reset = () => {
    this.keys.clear();
    this.velocity.set(0, 0, 0); this.wheelDistance = 0; this.lookPending = false;
    this.endLook();
  };
  private readonly endLook = () => {
    const pointer = this.pointer; this.pointer = null;
    if (pointer !== null && this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
  };
  private readonly keyDown = (event: KeyboardEvent) => {
    if (!this.enabled || this.isEditing() || document.hidden
      || event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^[1-5]$/.test(event.key)) { this.setSpeed(Number(event.key)); event.preventDefault(); return; }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(event.code)) {
      this.keys.add(event.code); event.preventDefault();
    }
  };
  private readonly keyUp = (event: KeyboardEvent) => { this.keys.delete(event.code); };
  private readonly canvasBlur = () => { if (this.isEditing()) this.reset(); else this.endLook(); };
  private readonly down = (event: PointerEvent) => {
    if (!this.enabled || event.button !== 0) return;
    this.canvas.focus({ preventScroll: true });
    this.look.setFromQuaternion(this.camera.quaternion, 'YXZ'); this.lookPending = true;
    this.pointer = event.pointerId; this.x = event.clientX; this.y = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
    event.preventDefault(); event.stopImmediatePropagation();
  };
  private readonly move = (event: PointerEvent) => {
    if (!this.enabled || this.pointer !== event.pointerId) return;
    this.look.y -= (event.clientX - this.x) * .003;
    this.look.x = THREE.MathUtils.clamp(this.look.x - (event.clientY - this.y) * .003, -Math.PI / 2 + .01, Math.PI / 2 - .01);
    this.look.z = 0;
    this.x = event.clientX; this.y = event.clientY;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  private readonly up = (event: PointerEvent) => {
    if (!this.enabled || this.pointer !== event.pointerId) return;
    this.pointer = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    event.preventDefault(); event.stopImmediatePropagation();
  };
  private readonly wheel = (event: WheelEvent) => {
    if (!this.enabled || event.ctrlKey || event.metaKey) return;
    this.canvas.focus({ preventScroll: true });
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.clientHeight : 1);
    const distance = -THREE.MathUtils.clamp(delta / 100, -4, 4) * flightSpeeds[this.speed - 1] * .25;
    this.wheelDistance += distance;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  public update(seconds: number): void {
    if (!this.enabled || this.isEditing() || document.hidden) { this.reset(); return; }
    const dt = Math.min(.1, Math.max(0, seconds));
    if (this.lookPending) {
      const target = new THREE.Quaternion().setFromEuler(this.look);
      this.camera.quaternion.slerp(target, 1 - Math.exp(-22 * dt));
      if (this.pointer === null && this.camera.quaternion.angleTo(target) < .0001) this.lookPending = false;
    }
    const local = new THREE.Vector3(Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')), 0,
      Number(this.keys.has('KeyS')) - Number(this.keys.has('KeyW')));
    local.applyQuaternion(this.camera.quaternion);
    local.y += Number(this.keys.has('KeyE')) - Number(this.keys.has('KeyQ'));
    if (local.lengthSq()) local.normalize().multiplyScalar(flightSpeeds[this.speed - 1]);
    // Integrate the exponential velocity exactly: travel is independent of the frame rate.
    const decay = Math.exp(-14 * dt);
    this.camera.position.addScaledVector(local, dt).addScaledVector(this.velocity.clone().sub(local), (1 - decay) / 14);
    this.velocity.lerp(local, 1 - decay);
    const dolly = this.wheelDistance * (1 - Math.exp(-16 * dt));
    this.wheelDistance -= dolly;
    this.camera.position.addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()), dolly);
  }
  private isEditing(): boolean {
    const element = document.activeElement as HTMLElement | null;
    return !!element && (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable
      || !!element.closest?.('[role="dialog"]'));
  }
  public dispose(): void {
    this.setEnabled(false); this.onSpeedChanged = null;
    this.canvas.removeEventListener('pointerdown', this.down, true);
    this.canvas.removeEventListener('pointermove', this.move, true);
    this.canvas.removeEventListener('pointerup', this.up, true);
    this.canvas.removeEventListener('pointercancel', this.up, true);
    this.canvas.removeEventListener('lostpointercapture', this.endLook);
    this.canvas.removeEventListener('wheel', this.wheel, true);
    this.canvas.removeEventListener('blur', this.canvasBlur);
    window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.reset); document.removeEventListener('visibilitychange', this.reset);
  }
}
