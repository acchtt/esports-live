export function installArenaBrand(root: ParentNode): void {
  const brandLink = root.querySelector<HTMLAnchorElement>('.brand-lockup');
  if (brandLink) brandLink.setAttribute('aria-label', 'ARENA matches');

  const brandMark = root.querySelector<HTMLElement>('.brand-mark');
  if (brandMark) {
    brandMark.textContent = '';
    brandMark.setAttribute('aria-hidden', 'true');
  }

  const brandName = root.querySelector<HTMLElement>('.brand-lockup strong');
  if (brandName) brandName.textContent = 'ARENA';
}
