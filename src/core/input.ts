// Tastatur + mus (pointer lock). Holder styr på holdte taster og taster trykket i denne frame.

export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  private mouseHeld = new Set<number>();
  private mousePressed = new Set<number>();
  mouseDX = 0;
  mouseDY = 0;
  enabled = true;
  onPointerLockChange: (locked: boolean) => void = () => {};
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!this.held.has(e.code)) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => {
      this.held.clear();
      this.mouseHeld.clear();
    });
    el.addEventListener('mousedown', (e) => {
      this.mouseHeld.add(e.button);
      this.mousePressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.mouseHeld.delete(e.button));
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.el) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    document.addEventListener('pointerlockchange', () => this.onPointerLockChange(this.locked));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get locked(): boolean {
    return document.pointerLockElement === this.el;
  }

  requestLock() {
    if (this.locked) return;
    try {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* fx i headless-tests */
    }
  }

  exitLock() {
    if (this.locked) document.exitPointerLock();
  }

  down(code: string): boolean {
    return this.enabled && this.held.has(code);
  }

  hit(code: string): boolean {
    return this.enabled && this.pressed.has(code);
  }

  mouseDown(button = 0): boolean {
    return this.enabled && this.mouseHeld.has(button);
  }

  mouseHit(button = 0): boolean {
    return this.enabled && this.mousePressed.has(button);
  }

  /** Bevægelsesakse: W/S og A/D (også piletaster). */
  axis(): { x: number; y: number } {
    const x = (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0);
    const y = (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0) - (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0);
    return { x, y };
  }

  /** Til automatiske tests: simulér en tast. */
  simulate(code: string, down: boolean) {
    if (down) {
      if (!this.held.has(code)) this.pressed.add(code);
      this.held.add(code);
    } else this.held.delete(code);
  }

  simulateMouse(button: number) {
    this.mousePressed.add(button);
  }

  endFrame() {
    this.pressed.clear();
    this.mousePressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}
