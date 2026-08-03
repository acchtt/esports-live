export type ObjectiveIconKey = 'towers' | 'dragons' | 'barons' | 'inhibitors';

const CUTOUT = '#071321';

const ICON_BODY: Record<ObjectiveIconKey, string> = {
  towers: `
    <path fill="currentColor" d="M7 6h8v8h10V6h8v12l-4 4v12H11V22l-4-4V6Z" />
    <path fill="${CUTOUT}" d="M12 17h16v4H12zM17 24h6v10h-6z" />
    <path fill="currentColor" d="M8 34h24v4H8z" />
  `,
  dragons: `
    <path fill="currentColor" d="M20 9 25 3l2 7c6 .9 10 5 11 11-4-2-7-2-10-1 3 3 5 6 5 11-3-3-7-5-11-4l-2 11-2-11c-4-1-8 1-11 4 0-5 2-8 5-11-3-1-6-1-10 1 1-6 5-10 11-11l2-7 5 6Z" />
    <path fill="${CUTOUT}" d="m14 15 6-4 6 4-2 9-4 4-4-4-2-9Z" />
    <path fill="currentColor" d="M16 17h3v3h-3zM21 17h3v3h-3zM17 23h6l-3 3-3-3Z" />
  `,
  barons: `
    <path fill="currentColor" d="M4 12 10 4l4 7 6-9 6 9 4-7 6 8-3 17-13 9L7 29 4 12Z" />
    <path fill="${CUTOUT}" d="M9 17c3-4 6-6 11-6s8 2 11 6c-3 5-6 7-11 7S12 22 9 17Z" />
    <circle cx="20" cy="17" r="4" fill="currentColor" />
    <circle cx="20" cy="17" r="1.6" fill="${CUTOUT}" />
    <circle cx="13" cy="12" r="1.4" fill="${CUTOUT}" />
    <circle cx="27" cy="12" r="1.4" fill="${CUTOUT}" />
    <path fill="${CUTOUT}" d="m12 29 8 5 8-5-3 7H15l-3-7Z" />
  `,
  inhibitors: `
    <path fill="currentColor" d="M20 2 32 14l-5 18-7 6-7-6-5-18L20 2Z" />
    <path fill="${CUTOUT}" d="m20 8 7 8-3 12-4 4-4-4-3-12 7-8Z" />
    <path fill="currentColor" d="m20 12 3 5-3 8-3-8 3-5Z" />
    <path fill="currentColor" d="M10 34h20v4H10z" />
  `
};

export function objectiveIcon(key: ObjectiveIconKey): string {
  return `
    <svg
      class="objective-emblem objective-emblem-${key}"
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      ${ICON_BODY[key]}
    </svg>`;
}
