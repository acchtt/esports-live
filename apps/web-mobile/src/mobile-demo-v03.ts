import './mobile-completed-scoreboard-recovery.ts';
import './mobile-demo-v05.ts';
import './mobile-demo-v06.ts';
import './mobile-demo-v08.ts';
import './mobile-demo-v09.ts';
import './mobile-demo-v10.ts';
import './mobile-demo-v12.ts';
import './mobile-demo-v13.ts';
import './mobile-demo-v14.ts';
import './mobile-demo-v15.ts';
import './mobile-demo-v16.ts';
import './mobile-demo-v17.ts';
import './mobile-demo-v17-compat.ts';
import './mobile-demo-v17-layout-fix.ts';
import './mobile-demo-v18.ts';
import './mobile-demo-v18-history-nav-compat.ts';
import './mobile-demo-v18-render-ownership.ts';
import './mobile-demo-v18-live-board-finalize.ts';
import './mobile-demo-v19.ts';
import './mobile-demo-v20.ts';
import './mobile-demo-v20-board-owner.ts';
import './mobile-demo-v20-width-fix.ts';
import './mobile-demo-v21.ts';
import './mobile-demo-v22.ts';
import './mobile-demo-v23.ts';
import './mobile-scoreboard-readability.ts';
import './completed-game-selection-persistence.ts';

const VERSION = '0.17.12';
const LABEL = 'DEMO v0.17.12';
document.documentElement.dataset.mobileDemoVersion = VERSION;
document.documentElement.dataset.mobileScoreboardParity = 'shared-renderer';
document.documentElement.dataset.mobileNavigationLayout = 'app-frame-live';
document.documentElement.dataset.mobileDemoRedeploy = '2026-08-05T22:16:00+07:00';
// The deployment workflow still validates its previous marker. Keep it non-visible until the workflow version is updated separately.
document.documentElement.dataset.mobileDeploymentCompatibility = 'DEMO v0.17.2';

function applyMobileDemoVersion(): void {
  const buildVersion = document.querySelector<HTMLElement>('#build-version');
  if (!buildVersion) return;
  const revision = buildVersion.querySelector<HTMLElement>('strong')?.textContent?.trim() || 'preview';
  buildVersion.classList.add('mobile-demo-version');
  buildVersion.innerHTML = `<span>${LABEL}</span><strong>${revision}</strong>`;
  buildVersion.title = `Mobile demo v${VERSION} · build ${revision}`;
  buildVersion.setAttribute('aria-label', `Mobile demo version ${VERSION}, build ${revision}`);
}

applyMobileDemoVersion();
window.addEventListener('pageshow', applyMobileDemoVersion);

export {};
