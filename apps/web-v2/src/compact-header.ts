const COMPACT_SCROLL_THRESHOLD = 48;

export function installCompactHeader(root: HTMLElement): () => void {
  const header = root.querySelector<HTMLElement>('.app-header');
  if (!header) return () => undefined;

  let animationFrame: number | null = null;

  const update = (): void => {
    animationFrame = null;
    const compact = window.scrollY > COMPACT_SCROLL_THRESHOLD;
    header.dataset.compact = String(compact);
  };

  const scheduleUpdate = (): void => {
    if (animationFrame !== null) return;
    animationFrame = window.requestAnimationFrame(update);
  };

  update();
  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate, { passive: true });

  return () => {
    window.removeEventListener('scroll', scheduleUpdate);
    window.removeEventListener('resize', scheduleUpdate);
    if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
  };
}
