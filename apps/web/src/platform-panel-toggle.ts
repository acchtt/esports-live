import './desktop-dashboard-redesign.ts';

const STORAGE_KEY = 'esports-live:platform-panel-collapsed';
const DESKTOP_QUERY = '(min-width: 1181px)';

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const workspace = requiredElement<HTMLElement>('#workspace');
const panel = requiredElement<HTMLElement>('#platform-panel');
const content = requiredElement<HTMLElement>('#platform-panel-content');
const toggle = requiredElement<HTMLButtonElement>('#platform-panel-toggle');
const icon = requiredElement<HTMLElement>('.platform-panel-toggle-icon');
const label = requiredElement<HTMLElement>('.platform-panel-toggle-label');
const desktop = window.matchMedia(DESKTOP_QUERY);

function storedPreference(): boolean | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === null ? null : value === 'true';
  } catch {
    return null;
  }
}

function storePreference(collapsed: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(collapsed));
  } catch {
    // The panel remains functional when browser storage is unavailable.
  }
}

function applyState(collapsed: boolean, persist = false): void {
  workspace.classList.toggle('platform-collapsed', collapsed);
  panel.dataset.collapsed = String(collapsed);
  content.setAttribute('aria-hidden', String(collapsed));
  content.inert = collapsed;
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.setAttribute('aria-label', collapsed ? 'Expand platform status' : 'Collapse platform status');
  icon.textContent = collapsed ? '‹' : '›';
  label.textContent = collapsed ? 'Platform' : 'Fold';
  if (persist) storePreference(collapsed);
}

let preference = storedPreference();
applyState(preference ?? desktop.matches);

toggle.addEventListener('click', () => {
  const collapsed = panel.dataset.collapsed === 'true';
  preference = !collapsed;
  applyState(!collapsed, true);
});

desktop.addEventListener('change', event => {
  if (preference === null) applyState(event.matches);
});
