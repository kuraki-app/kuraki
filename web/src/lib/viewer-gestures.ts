type Actions = { move: (delta: number) => void; close: () => void };

/** Pointer events cover mouse, pen and touch without a gesture dependency. */
export function viewerGestures(node: HTMLElement, actions: Actions) {
  const points = new Map<number, { x: number; y: number }>();
  let scale = 1;
  let x = 0;
  let y = 0;
  let start = { x: 0, y: 0 };
  let pan = { x: 0, y: 0 };
  let pinch = 0;
  let baseScale = 1;
  let multitouch = false;
  const distance = () => {
    const [a, b] = [...points.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  function draw() {
    const bounds = node.getBoundingClientRect();
    const maxX = bounds.width * (scale - 1) / 2;
    const maxY = bounds.height * (scale - 1) / 2;
    x = Math.max(-maxX, Math.min(maxX, x));
    y = Math.max(-maxY, Math.min(maxY, y));
    node.style.setProperty('--viewer-scale', String(scale));
    node.style.setProperty('--viewer-x', `${x}px`);
    node.style.setProperty('--viewer-y', `${y}px`);
  }
  function down(e: PointerEvent) {
    if (e.button !== 0 || (e.target as Element).closest('button,a,input,video')) return;
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    node.setPointerCapture(e.pointerId);
    if (points.size === 1) {
      multitouch = false;
      start = { x: e.clientX, y: e.clientY };
      pan = { x, y };
    } else {
      multitouch = true;
      pinch = distance();
      baseScale = scale;
    }
  }
  function move(e: PointerEvent) {
    if (!points.has(e.pointerId)) return;
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (points.size > 1 && pinch > 0) scale = Math.max(1, Math.min(4, baseScale * distance() / pinch));
    else if (scale > 1 && !multitouch) {
      x = pan.x + e.clientX - start.x;
      y = pan.y + e.clientY - start.y;
    }
    draw();
  }
  function up(e: PointerEvent) {
    if (!points.has(e.pointerId)) return;
    points.delete(e.pointerId);
    if (e.type === 'pointercancel' || multitouch || scale > 1) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.5) actions.move(dx < 0 ? 1 : -1);
    else if (dy > 120 && dy > Math.abs(dx) * 1.5) actions.close();
  }
  function doubleClick(e: MouseEvent) {
    if ((e.target as Element).closest('button,a,video')) return;
    scale = scale === 1 ? 2 : 1;
    x = y = 0;
    draw();
  }
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('dblclick', doubleClick);
  return { destroy() {
    node.removeEventListener('pointerdown', down);
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', up);
    node.removeEventListener('pointercancel', up);
    node.removeEventListener('dblclick', doubleClick);
  } };
}
