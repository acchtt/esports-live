import './mobile-completed-scoreboard-recovery.ts';
import './mobile-demo-v05.ts';
import './mobile-demo-v06.ts';
import './mobile-demo-v08.ts';
import './mobile-demo-v09.ts';
import './mobile-demo-v10.ts';
import './mobile-demo-v12.ts';
import './mobile-demo-v13.ts';

const VERSION = '0.13';
const LABEL = 'DEMO v0.13';
document.documentElement.dataset.mobileDemoVersion = VERSION;

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
