// Небольшой набор своих иконок (SVG), чтобы интерфейс не был россыпью эмодзи.
const svg = (body, cls) => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const I = {
  food: svg('<path d="M12 3c-4 3-6 6.5-6 10a6 6 0 0 0 12 0c0-3.5-2-7-6-10z" fill="currentColor"/><path d="M12 9v11" stroke="#0e1117" stroke-width="1.6" fill="none"/>', 'i-food'),
  prod: svg('<path d="M10.3 2h3.4l.5 2.6 2 .9 2.2-1.5 2.4 2.4-1.5 2.2.9 2 2.6.5v3.4l-2.6.5-.9 2 1.5 2.2-2.4 2.4-2.2-1.5-2 .9-.5 2.6h-3.4l-.5-2.6-2-.9-2.2 1.5-2.4-2.4 1.5-2.2-.9-2L2 13.7v-3.4l2.6-.5.9-2L4 5.6 6.4 3.2l2.2 1.5 2-.9z" fill="currentColor"/><circle cx="12" cy="12" r="3.2" fill="#0e1117"/>', 'i-prod'),
  sci: svg('<path d="M9 2h6v2h-1v5l5.5 9.5A2 2 0 0 1 17.8 21H6.2a2 2 0 0 1-1.7-2.5L10 9V4H9z" fill="currentColor"/><path d="M7.5 15h9" stroke="#0e1117" stroke-width="1.6"/>', 'i-sci'),
  gold: svg('<circle cx="12" cy="12" r="9" fill="currentColor"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="#0e1117" stroke-width="1.6"/>', 'i-gold'),
  hp: svg('<path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z" fill="currentColor"/>', 'i-hp'),
  moves: svg('<path d="M4 12h12M12 6l6 6-6 6" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>', 'i-moves'),
  str: svg('<path d="M14.5 3H21v6.5L10 20.5 7.5 18l-3 3L3 19.5l3-3L3.5 14z" fill="currentColor"/>', 'i-str'),
  rng: svg('<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5" stroke="currentColor" stroke-width="2"/>', 'i-rng'),
  def: svg('<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" fill="currentColor"/>', 'i-def'),
  city: svg('<path d="M3 21V10l5-3v3l5-3v3l5-3v14z" fill="currentColor"/>', 'i-city'),
  build: svg('<path d="M3 21h18M5 21V9h6v12M13 21V4h6v17" stroke="currentColor" stroke-width="2.2" fill="none"/>', 'i-build'),
  map: svg('<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>', 'i-map'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>', 'i-menu'),
  close: svg('<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>', 'i-close'),
  skip: svg('<path d="M4 5l9 7-9 7zM13 5l7 7-7 7" fill="currentColor"/>', 'i-skip'),
  crown: svg('<path d="M3 18L2 7l5 4 5-7 5 7 5-4-1 11z" fill="currentColor"/>', 'i-crown'),
  star: svg('<path d="M12 2l3 7h7l-5.6 4.3L18.5 21 12 16.8 5.5 21l2.1-7.7L2 9h7z" fill="currentColor"/>', 'i-star'),
  gift: svg('<path d="M3 9h18v4H3zM5 13h14v8H5zM12 9v12M12 9c-2-4-6-4-6-1.5S10 9 12 9c2 0 6 0 6-1.5S14 5 12 9z" fill="none" stroke="currentColor" stroke-width="2"/>', 'i-gift'),
  up: svg('<path d="M12 4l7 8h-4v8H9v-8H5z" fill="currentColor"/>', 'i-up'),
};

export const EXT = { v: 'webp' };

export function thumb(name, cls = '') {
  return `<img class="thumb ${cls}" src="assets/${name}.${EXT.v}" alt="" loading="lazy">`;
}
