/* Inline SVG icons drawn on a 24px grid, plus the notebook logo. */
export const ICONS = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  board: '<rect x="3" y="3.5" width="18" height="17" rx="2.5"/><path d="M8.5 7.5v8M12.5 7.5v4.5M16.5 7.5v10"/>',
  notebook: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15Z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7.5h6M9 11h4"/>',
  insights: '<path d="M3.5 3.5v17h17"/><path d="M8 16.5v-4M12.5 16.5V8M17 16.5v-6"/>',
  trash: '<path d="M3.5 6.5h17M9 6.5V4.8c0-.7.6-1.3 1.3-1.3h3.4c.7 0 1.3.6 1.3 1.3v1.7M18.5 6.5l-.8 12.6c-.1 1.3-1.1 2.4-2.4 2.4H8.7c-1.3 0-2.3-1.1-2.4-2.4L5.5 6.5M10 11v6M14 11v6"/>',
  settings: '<path d="M4 21v-6.5M4 10.5V3M12 21v-8.5M12 8.5V3M20 21v-4.5M20 12.5V3M1.5 14.5h5M9.5 8.5h5M17.5 16.5h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20.5 20.5-4.9-4.9"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6.5 9.5 17 4 11.5"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  forward: '<path d="m9 18 6-6-6-6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V7.5A1.5 1.5 0 0 1 5.5 6H11"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  moon: '<path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.6 6.6 0 0 0 10.7 10.7Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  system: '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  download: '<path d="M12 3.5v11M7 10l5 5 5-5M4 16.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2.5"/>',
  upload: '<path d="M12 15V4M7 8.5l5-5 5 5M4 16.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2.5"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  more: '<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>',
  move: '<path d="M16 3.5 20 7.5l-4 4M20 7.5H5M8 20.5l-4-4 4-4M4 16.5h15"/>',
  select: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m8 12 3 3 5-6"/>',
  restore: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M19 10c0 5.2-7 11-7 11s-7-5.8-7-11a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5c.8-3.6 4-5.5 8-5.5s7.2 1.9 8 5.5"/>',
  flag: '<path d="M5 21V4.5M5 4.5c4-2.4 7 2.4 14 0v9c-7 2.4-10-2.4-14 0"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.5 5.2 3.5 8.5s-1.1 6.2-3.5 8.5c-2.4-2.3-3.5-5.2-3.5-8.5S9.6 5.8 12 3.5Z"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3A4.5 4.5 0 0 0 13 4.6l-1.2 1.2M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4"/>',
  sparkle: '<path d="M12 3.5c.6 4.3 2.2 6 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.5 5.9-2.2 6.5-6.5ZM18.5 15.5c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5Z"/>',
  install: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M12 7v7M9 11.5l3 3 3-3M10.5 18.5h3"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  file: '<path d="M14 3.5H7A2.5 2.5 0 0 0 4.5 6v12A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5V9L14 3.5Z"/><path d="M14 3.5V9h5.5M8.5 13h7M8.5 16.5h5"/>',
  inbox: '<path d="M3.5 13.5 6 5.5A2 2 0 0 1 8 4h8a2 2 0 0 1 2 1.5l2.5 8M3.5 13.5V18a2.5 2.5 0 0 0 2.5 2.5h12a2.5 2.5 0 0 0 2.5-2.5v-4.5M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5"/>'
};
export const LOGO = '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="3" y="3" width="34" height="34" rx="9" fill="#1f3447"/><rect x="10" y="8.5" width="21" height="24" rx="3" fill="#fbf8f1"/><path d="M14.5 16h11M14.5 20.5h11M14.5 25h7" stroke="#9fb1bd" stroke-width="1.8" stroke-linecap="round"/><path d="M25 8.5h4.5v10l-2.25-1.8L25 18.5Z" fill="#e0663f"/><g fill="#1f3447"><circle cx="10" cy="13" r="1.4"/><circle cx="10" cy="19" r="1.4"/><circle cx="10" cy="25" r="1.4"/></g></svg>';

export function icon(name, className = "") {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ""}</svg>`;
}
