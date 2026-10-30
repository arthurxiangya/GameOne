import type { IconId } from '@lanternwood/shared';

const stroke = (d: string): string =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
const fill = (d: string): string => `<path d="${d}" fill="currentColor"/>`;

/** One 24×24 glyph per skill icon in the class configs. */
const ICONS: Readonly<Record<IconId, string>> = {
  shield: fill('M12 2.5 4 5.5v6c0 4.6 3.3 8.3 8 10 4.7-1.7 8-5.4 8-10v-6z'),
  shout: stroke('M4 9.5h3l5-4v13l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12'),
  wall: stroke('M3.5 6.5h17v12h-17zM3.5 12.5h17M9 6.5v6M15 6.5v6M6.5 12.5v6M12 12.5v6M17.5 12.5v6'),
  slam: stroke('M12 3v8M8 7l4 4 4-4M3 15c3 0 3 3 6 3s3-3 6-3 3 3 6 3M5 20.5h14'),
  sun: `<circle cx="12" cy="12" r="4.2" fill="currentColor"/>${stroke('M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8')}`,
  cross: fill('M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z'),
  burst: fill('M12 2l2.4 6.2L21 9l-5 4.3L17.6 20 12 16.6 6.4 20 8 13.3 3 9l6.6-.8z'),
  ward: `${stroke('M12 3 5 6v5.5c0 4 2.9 7.3 7 9 4.1-1.7 7-5 7-9V6z')}${fill('M12 8.5l1.4 2.8 3 .4-2.2 2.1.5 3-2.7-1.4-2.7 1.4.5-3-2.2-2.1 3-.4z')}`,
  arrow: stroke('M4 20 19 5M13.5 5H19v5.5M4 20l2.5-.5M4 20l.5-2.5M6 15l3 3'),
  aim: `${stroke('M12 3v4M12 17v4M3 12h4M17 12h4')}<circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/>`,
  pin: stroke('M5 19 17 7M12.5 7H17v4.5M3 21l3.5-3.5M14 14.5l5.5 5.5M19.5 14.5 14 20'),
  volley: stroke('M4 13 11 6M9 15l7-7M14 17l7-7M7 6h4v4M14 8h2v2M17 10h4v4'),
  sword: stroke('M14 3.5h6.5V10L10 20.5l-1.8.4-.6-1.9L18 8.6M4.5 14.5l5 5M3.5 20.5l3-3'),
  flame: fill('M12.5 2.5c.8 3.6 5.5 5.2 5.5 10.5a6 6 0 0 1-12 0c0-3 1.8-4.6 2.6-6.3.8 1.2 1.6 2.2 1.9 3.3.6-2.3.9-4.8 2-7.5z'),
  heart: fill('M12 20.5s-8-4.8-8-10.4A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 8 2.5c0 5.6-8 10.4-8 10.4z'),
  inferno: `${fill('M12 4c.6 2.7 4 3.9 4 7.6a4 4 0 0 1-8 0c0-2 1.2-3.1 1.8-4.3.5.8 1 1.5 1.3 2.3.4-1.6.5-3.4.9-5.6z')}${stroke('M3 19.5c2-1 4-1 6 0s4 1 6 0 4-1 6 0')}`,
  bell: `${fill('M12 3.5a5.5 5.5 0 0 0-5.5 5.5v4.5L4.5 17h15l-2-3.5V9A5.5 5.5 0 0 0 12 3.5z')}<circle cx="12" cy="19.5" r="1.8" fill="currentColor"/>`,
  horn: stroke('M3.5 10v4l3 .5 9 4.5V5l-9 4.5zM6.5 14.5l1.5 5h2.5l-1-4.5M18.5 9a4 4 0 0 1 0 6M20.5 6.5a7.5 7.5 0 0 1 0 11'),
  discord: stroke('M4 12c2-4 4-4 6 0s4 4 6 0 3-3 4-2M4 7l3 2M20 17l-3-2M7 19l2-3M17 5l-2 3'),
  note: `${fill('M9 17.5a2.5 2.5 0 1 1-2.5-2.5H9V5l10-2v12.5a2.5 2.5 0 1 1-2.5-2.5H19')}`,
  tonic: fill('M9 2.5h6v5l5 8.5a3 3 0 0 1-2.6 4.5H6.6A3 3 0 0 1 4 16l5-8.5z'),
};

export const iconSvg = (icon: IconId): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`;
