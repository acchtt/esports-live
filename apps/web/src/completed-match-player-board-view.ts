export {};

const DDRAGON_VERSIONS = 'https://ddragon.leagueoflegends.com/api/versions.json';
const DDRAGON_CDN = 'https://ddragon.leagueoflegends.com/cdn';
const DDRAGON_TIMEOUT_MS = 4_000;
const ITEM_SLOTS = 7;

let versionPromise: Promise<string | null> | null = null;

const style = document.createElement('style');
style.textContent = `
.completed-game-tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
.completed-game-tab{min-height:38px;padding:8px 10px;border:1px solid var(--border);border-radius:10px;color:var(--muted);background:rgba(255,255,255,.018);cursor:pointer;font-size:.68rem;font-weight:850}
.completed-game-tab.active{border-color:rgba(56,189,248,.38);color:#e0f7ff;background:rgba(56,189,248,.08)}
.completed-final-game[data-board-hidden="true"]{display:none!important}
.completed-final-player.history-player-board{display:grid;grid-template-areas:"profile stats" "profile items";grid-template-columns:minmax(0,1fr) minmax(176px,auto);gap:9px 12px;align-items:center;min-height:106px;padding:14px 18px;border:1px solid rgba(148,163,184,.13);border-radius:12px;background:linear-gradient(135deg,rgba(15,23,42,.78),rgba(15,23,42,.44));font-size:.68rem}
.completed-final-team.blue .history-player-board{border-left:2px solid rgba(56,189,248,.45)}
.completed-final-team.red .history-player-board{border-left:2px solid rgba(251,113,133,.45)}
.history-player-profile{grid-area:profile;display:grid;grid-template-columns:44px 58px minmax(0,1fr);align-items:center;gap:10px;min-width:0}
.history-champion{position:relative;width:44px;height:44px;overflow:hidden;border:1px solid rgba(148,163,184,.16);border-radius:10px;background:rgba(15,23,42,.92)}
.history-champion img,.history-item img{width:100%;height:100%;object-fit:cover}
.history-champion span{position:absolute;inset:0;display:grid;place-items:center;color:#94a3b8;font-size:.62rem;font-weight:900}
.history-role{display:grid;place-items:center;min-width:58px;min-height:26px;padding:4px 8px;border:1px solid rgba(56,189,248,.2);border-radius:999px;color:#bae6fd;background:rgba(56,189,248,.08);font-size:.54rem;font-weight:900;text-transform:uppercase}
.completed-final-team.red .history-role{border-color:rgba(251,113,133,.2);color:#fecdd3;background:rgba(251,113,133,.08)}
.history-copy{min-width:0}.history-copy strong,.history-copy span{display:block;overflow-wrap:anywhere}.history-copy strong{color:#f8fafc;font-size:.9rem;line-height:1.25}.history-copy span{margin-top:3px;color:#a5b2c3;font-size:.64rem}
.history-stats{grid-area:stats;display:grid;grid-template-columns:repeat(3,minmax(52px,auto));gap:6px}.history-stat{min-width:52px;padding:6px 8px;border:1px solid rgba(148,163,184,.13);border-radius:8px;background:rgba(15,23,42,.44);text-align:right}.history-stat span,.history-stat strong{display:block}.history-stat span{color:#94a3b8;font-size:.5rem;letter-spacing:.05em}.history-stat strong{margin-top:3px;color:#f1f5f9;font-size:.72rem}
.history-items{grid-area:items;display:flex;align-items:center;justify-content:flex-end;gap:5px;min-width:0}.history-items-label{margin-right:3px;color:#8f9caf;font-size:.46rem;font-weight:850;letter-spacing:.06em}.history-item{width:23px;height:23px;overflow:hidden;flex:0 0 auto;border:1px solid rgba(148,163,184,.13);border-radius:5px;background:rgba(15,23,42,.72)}.history-item.empty{opacity:.42}
@media(max-width:920px){.completed-final-player.history-player-board{grid-template-areas:"profile" "stats" "items";grid-template-columns:1fr;min-height:0;padding:12px 10px}.history-player-profile{grid-template-columns:40px minmax(0,1fr)}.history-champion{width:40px;height:40px}.history-role{display:none}.history-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.history-stat{text-align:left}.history-items{justify-content:flex-start;overflow-x:auto}}
`;
document.head.append(style);

function esc(value: unknown): string {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}

function version(): Promise<string | null> {
  if (versionPromise) return versionPromise;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), DDRAGON_TIMEOUT_MS);
  versionPromise = fetch(DDRAGON_VERSIONS,{cache:'force-cache',signal:controller.signal})
    .then(response => response.ok ? response.json() : [])
    .then(value => Array.isArray(value) && typeof value[0] === 'string' ? value[0] : null)
    .catch(() => null)
    .finally(() => window.clearTimeout(timeout));
  return versionPromise;
}

function championKey(value: string): string | null {
  const key = value.replace(/[^a-z0-9]/gi,'');
  if (!key || /^\d+$/.test(key)) return null;
  return ({Wukong:'MonkeyKing',NunuWillump:'Nunu',RenataGlasc:'Renata'} as Record<string,string>)[key] ?? key;
}

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).slice(0,2).map(word => word[0]?.toUpperCase() ?? '').join('') || '?';
}

function roleLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('top')) return 'Top';
  if (normalized.includes('jung')) return 'Jungle';
  if (normalized.includes('mid')) return 'Mid';
  if (normalized.includes('bot') || normalized.includes('adc') || normalized.includes('carry')) return 'Bottom';
  if (normalized.includes('sup') || normalized.includes('utility')) return 'Support';
  return value || 'Player';
}

function kda(value: string): string { return value.match(/(?:\d+|—)\/(?:\d+|—)\/(?:\d+|—)/)?.[0] ?? '— / — / —'; }
function cs(value: string): string { return value.match(/(?:\d[\d,]*|—)\s*CS/i)?.[0]?.replace(/\s*CS/i,'') ?? '—'; }
function gold(value: string): string { return value.match(/(?:\d[\d,]*|—)g\b/i)?.[0]?.replace(/g$/i,'') ?? '—'; }
function itemIds(value: string): string[] {
  return [...value.matchAll(/\b\d{4}\b/g)].map(match => match[0]).filter(id => Number(id) > 0).slice(0,ITEM_SLOTS);
}
function stat(label: string,value: string): string { return `<div class="history-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }

function items(ids: readonly string[], patch: string | null): string {
  const slots = Array.from({length:ITEM_SLOTS},(_,index) => {
    const id = ids[index];
    if (!id || !patch) return '<span class="history-item empty" aria-hidden="true"></span>';
    const src = `${DDRAGON_CDN}/${encodeURIComponent(patch)}/img/item/${encodeURIComponent(id)}.png`;
    return `<span class="history-item" title="Item ${esc(id)}"><img src="${esc(src)}" alt="Item ${esc(id)}"></span>`;
  }).join('');
  return `<div class="history-items"><span class="history-items-label">ITEMS</span>${slots}</div>`;
}

function transform(row: HTMLElement, patch: string | null): void {
  if (row.dataset.boardEnhanced === 'true') return;
  const copy = row.querySelector<HTMLElement>('div');
  const name = copy?.querySelector('strong')?.textContent?.trim() || 'Unknown player';
  const champion = row.dataset.champion || copy?.querySelector('small')?.textContent?.trim() || 'Champion unavailable';
  const role = roleLabel(row.dataset.role || 'Player');
  const values = [...row.querySelectorAll<HTMLElement>(':scope > span')].map(node => node.textContent ?? '');
  const key = championKey(champion);
  const championSrc = patch && key ? `${DDRAGON_CDN}/${encodeURIComponent(patch)}/img/champion/${encodeURIComponent(key)}.png` : null;

  row.dataset.boardEnhanced = 'true';
  row.classList.add('history-player-board');
  row.innerHTML = `
    <div class="history-player-profile">
      <div class="history-champion">${championSrc ? `<img src="${esc(championSrc)}" alt="${esc(champion)}">` : ''}<span>${esc(initials(champion))}</span></div>
      <span class="history-role">${esc(role)}</span>
      <div class="history-copy"><strong>${esc(name)}</strong><span>${esc(champion)}</span></div>
    </div>
    <div class="history-stats">${stat('KDA',kda(values[0] ?? ''))}${stat('CS',cs(values[0] ?? ''))}${stat('GOLD',gold(values[1] ?? ''))}</div>
    ${items(itemIds(values[1] ?? ''),patch)}`;
  row.querySelectorAll<HTMLImageElement>('img').forEach(image => image.addEventListener('error',() => { image.hidden = true; },{once:true}));
}

function numberOf(game: HTMLElement,index: number): string {
  return game.querySelector('.completed-final-game-header strong')?.textContent?.match(/Game\s+(\d+)/i)?.[1] ?? String(index+1);
}

function applySelection(host: HTMLElement, selected: string): void {
  const games = [...host.querySelectorAll<HTMLElement>('.completed-final-game')];
  const tabs = host.querySelector<HTMLElement>('.completed-game-tabs');
  host.dataset.selectedFinalGame = selected;
  games.forEach((game,index) => { game.dataset.boardHidden = String(numberOf(game,index)!==selected); });
  tabs?.querySelectorAll<HTMLButtonElement>('[data-final-game-tab]').forEach(button => {
    button.classList.toggle('active',button.dataset.finalGameTab===selected);
  });
}

function bindTabs(host: HTMLElement): void {
  if (host.dataset.finalGameTabsBound === 'true') return;
  host.dataset.finalGameTabsBound = 'true';
  host.addEventListener('click',event => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('[data-final-game-tab]')
      : null;
    if (!target || !host.contains(target)) return;
    const selected = target.dataset.finalGameTab;
    if (selected) applySelection(host,selected);
  });
}

function installTabs(host: HTMLElement): void {
  const games = [...host.querySelectorAll<HTMLElement>('.completed-final-game')];
  if (!games.length) return;
  bindTabs(host);
  let tabs = host.querySelector<HTMLElement>('.completed-game-tabs');
  if (!tabs) {
    tabs = document.createElement('div');
    tabs.className = 'completed-game-tabs';
    host.querySelector('.completed-telemetry-heading')?.insertAdjacentElement('afterend',tabs);
  }
  const numbers = games.map(numberOf);
  const selected = host.dataset.selectedFinalGame && numbers.includes(host.dataset.selectedFinalGame)
    ? host.dataset.selectedFinalGame
    : numbers.at(-1)!;
  const entries = games.map((game,index) => {
    const number = numberOf(game,index);
    const label = game.querySelector('.completed-final-game-header strong')?.textContent?.trim() || `Game ${number}`;
    return {number,label};
  });
  const signature = JSON.stringify(entries);
  if (tabs.dataset.signature !== signature) {
    tabs.dataset.signature = signature;
    tabs.innerHTML = entries.map(({number,label}) =>
      `<button type="button" class="completed-game-tab" data-final-game-tab="${esc(number)}">${esc(label)}</button>`
    ).join('');
  }
  applySelection(host,selected);
}

async function enhance(): Promise<void> {
  const host = document.querySelector<HTMLElement>('#completed-final-telemetry');
  if (!host) return;
  installTabs(host);
  const rows = [...host.querySelectorAll<HTMLElement>('.completed-final-player')]
    .filter(row => row.dataset.boardEnhanced !== 'true');
  if (!rows.length) return;
  const patch = await version();
  rows.filter(row => row.isConnected).forEach(row => transform(row,patch));
  if (host.isConnected) installTabs(host);
}

function includesTelemetry(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  return node.matches('#completed-final-telemetry,.completed-final-game,.completed-final-player')
    || Boolean(node.querySelector('#completed-final-telemetry,.completed-final-game,.completed-final-player'));
}

let scheduled = false;
let running = false;
let rerun = false;

function queue(): void {
  if (running) {
    rerun = true;
    return;
  }
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => { void run(); });
}

async function run(): Promise<void> {
  scheduled = false;
  running = true;
  try {
    await enhance();
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      queue();
    }
  }
}

new MutationObserver(mutations => {
  if (mutations.some(mutation => [...mutation.addedNodes].some(includesTelemetry))) queue();
}).observe(document.body,{childList:true,subtree:true});
queue();
