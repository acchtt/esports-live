export {};

const EMPTY_SLOT_SELECTOR = '.telemetry-item-slot.empty, .history-item.empty';
const ROLE_INVENTORY_SELECTOR = '.role-player-items .telemetry-inventory';
const HISTORY_INVENTORY_SELECTOR = '.history-items';

const style = document.createElement('style');
style.textContent = `
  .role-player-items[hidden],
  .history-items[hidden] {
    display: none !important;
  }

  .inventory-availability-note {
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 28px;
    margin: 0 10px 8px;
    color: #728198;
    font-size: .56rem;
    font-weight: 700;
    letter-spacing: .02em;
  }

  .inventory-availability-note::before {
    content: '';
    width: 5px;
    height: 5px;
    flex: 0 0 5px;
    border-radius: 999px;
    background: rgba(148, 163, 184, .48);
  }
`;
document.head.append(style);

function slotHasRenderableItem(slot: Element): boolean {
  const image = slot.querySelector<HTMLImageElement>('img');
  return Boolean(image && !image.hidden);
}

function inventoryHasItems(inventory: Element): boolean {
  const slots = inventory.querySelectorAll<HTMLElement>('.telemetry-item-slot:not(.empty), .history-item:not(.empty)');
  return [...slots].some(slotHasRenderableItem);
}

function cleanInventory(inventory: HTMLElement): void {
  inventory.querySelectorAll<HTMLElement>(EMPTY_SLOT_SELECTOR).forEach(slot => slot.remove());
  const holder = inventory.matches('.history-items')
    ? inventory
    : inventory.closest<HTMLElement>('.role-player-items') ?? inventory;
  const hasItems = inventoryHasItems(inventory);
  if (hasItems) holder.removeAttribute('hidden');
  else if (!holder.hasAttribute('hidden')) holder.setAttribute('hidden', '');
}

function syncGroupNote(group: HTMLElement, inventorySelector: string, anchorSelector: string): void {
  const inventories = [...group.querySelectorAll<HTMLElement>(inventorySelector)];
  const existing = group.querySelector<HTMLElement>(':scope > .inventory-availability-note');
  if (!inventories.length) {
    existing?.remove();
    return;
  }

  const hasAnyItems = inventories.some(inventoryHasItems);
  if (hasAnyItems) {
    existing?.remove();
    return;
  }

  if (existing) return;
  const note = document.createElement('div');
  note.className = 'inventory-availability-note';
  note.textContent = 'Item data unavailable for this snapshot';
  const anchor = group.querySelector<HTMLElement>(anchorSelector);
  if (anchor) group.insertBefore(note, anchor);
  else group.append(note);
}

function roleGroups(): HTMLElement[] {
  return [...new Set(
    [...document.querySelectorAll<HTMLElement>('.role-matchup-row')]
      .map(row => row.parentElement)
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
  )];
}

function updateInventories(): void {
  document.querySelectorAll<HTMLElement>(ROLE_INVENTORY_SELECTOR).forEach(cleanInventory);
  document.querySelectorAll<HTMLElement>(HISTORY_INVENTORY_SELECTOR).forEach(cleanInventory);

  roleGroups().forEach(group => syncGroupNote(group, ROLE_INVENTORY_SELECTOR, '.role-matchup-row'));
  document.querySelectorAll<HTMLElement>('.completed-final-game').forEach(group => {
    syncGroupNote(group, HISTORY_INVENTORY_SELECTOR, '.completed-final-team-grid, .completed-final-matchups');
  });
}

let queued = false;
function queueUpdate(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    updateInventories();
  });
}

const observer = new MutationObserver(queueUpdate);
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['hidden', 'class']
});

window.addEventListener('esports-live:snapshot', queueUpdate);
window.addEventListener('esports-live:ended-snapshot', queueUpdate);
window.addEventListener('esports-live:selection', queueUpdate);
window.addEventListener('beforeunload', () => observer.disconnect());

queueUpdate();
