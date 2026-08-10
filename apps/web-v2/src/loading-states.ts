const LOADING_META_PREFIX = 'Loading live';
const LOADING_CATALOGUE_PREFIX = 'Loading matches';
const LOADING_PLAYERS_PREFIX = 'Player statistics pending';

function loadingIcon(size: 'inline' | 'large' = 'large'): HTMLElement {
  const icon = document.createElement('span');
  icon.className = `arena-loading-icon arena-loading-icon--${size}`;
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function accessibleLabel(text: string): HTMLElement {
  const label = document.createElement('span');
  label.className = 'arena-loading-sr';
  label.textContent = text;
  return label;
}

function decorateCatalogueMeta(root: ParentNode): void {
  const meta = root.querySelector<HTMLElement>('#catalogue-meta');
  if (!meta) return;

  const currentText = meta.textContent?.trim() ?? '';
  if (currentText.startsWith(LOADING_META_PREFIX)) {
    if (meta.classList.contains('arena-loading-inline')) return;
    meta.classList.add('arena-loading-inline');
    meta.replaceChildren(loadingIcon('inline'), accessibleLabel('Loading matches'));
    return;
  }

  if (meta.classList.contains('arena-loading-inline')) {
    meta.classList.remove('arena-loading-inline');
  }
}

function decorateEmptyState(
  element: HTMLElement,
  prefix: string,
  label: string
): void {
  if (element.classList.contains('arena-loading-state')) return;
  const heading = element.querySelector('strong')?.textContent?.trim() ?? '';
  if (!heading.startsWith(prefix)) return;

  element.classList.add('arena-loading-state');
  element.setAttribute('role', 'status');
  element.replaceChildren(loadingIcon('large'), accessibleLabel(label));
}

function decorateLoadingStates(root: ParentNode): void {
  decorateCatalogueMeta(root);

  root.querySelectorAll<HTMLElement>('.catalogue-empty').forEach(element => {
    decorateEmptyState(element, LOADING_CATALOGUE_PREFIX, 'Loading matches');
  });

  root.querySelectorAll<HTMLElement>('.player-board-empty').forEach(element => {
    decorateEmptyState(element, LOADING_PLAYERS_PREFIX, 'Loading player statistics');
  });
}

export function installLoadingStates(root: HTMLElement): void {
  decorateLoadingStates(root);

  const observer = new MutationObserver(() => decorateLoadingStates(root));
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true
  });
}
