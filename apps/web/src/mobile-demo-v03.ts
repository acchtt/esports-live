const VERSION = '0.3';
const LABEL = 'DEMO v0.3';

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
