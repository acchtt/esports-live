import './mobile-demo.ts';
import './mobile-demo-v03.ts';

const workspace = document.querySelector<HTMLElement>('#workspace');
const platformPanel = document.querySelector<HTMLElement>('#platform-panel');
const gameContent = document.querySelector<HTMLElement>('#game-content');

function activateDashboardV2(): void {
  workspace?.classList.add('dashboard-v2-active');
  if (platformPanel) platformPanel.hidden = true;
}

activateDashboardV2();

if (gameContent) {
  const observer = new MutationObserver(() => activateDashboardV2());
  observer.observe(gameContent, { childList: true, subtree: true });
}

window.addEventListener('esports-live:selection', activateDashboardV2);
window.addEventListener('esports-live:snapshot', activateDashboardV2);
