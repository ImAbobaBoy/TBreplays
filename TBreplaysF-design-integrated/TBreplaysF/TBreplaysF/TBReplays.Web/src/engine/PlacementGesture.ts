// OrbitControls keeps the pointer until release. Placement only commits a stationary left click.
export class PlacementGesture {
  private start: { id: number; x: number; y: number; dragged: boolean } | null = null;
  public down(event: PointerEvent): void {
    if (event.button === 0 && event.isPrimary !== false && !this.start)
      this.start = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
  }
  public move(event: PointerEvent): void {
    if (this.start?.id === event.pointerId && Math.hypot(event.clientX - this.start.x, event.clientY - this.start.y) > 5)
      this.start.dragged = true;
  }
  public up(event: PointerEvent): boolean {
    if (this.start?.id !== event.pointerId) return false;
    this.move(event);
    const click = event.type !== 'pointercancel' && event.button === 0 && !this.start!.dragged;
    this.cancel(); return click;
  }
  public cancel(): void { this.start = null; }
}
