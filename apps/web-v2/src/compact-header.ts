const FOLD_SCROLL_THRESHOLD = 112;
const UNFOLD_SCROLL_THRESHOLD = 16;

export function installCompactHeader(root: HTMLElement): () => void {
  const header = root.querySelector<HTMLElement>('.app-header');
  if (!header) return () => undefined;

  let animationFrame: number | null = null;
  let folded = false;

  const update = (): void => {
    animationFrame = null;
    const scrollY = window.scrollY;
    if (!folded && scrollY > FOLD_SCROLL_THRESHOLD) folded = true;
    else if (folded && scrollY <= UNFOLD_SCROLL_THRESHOLD) folded = false;
    header.dataset.compact = String(folded);
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
