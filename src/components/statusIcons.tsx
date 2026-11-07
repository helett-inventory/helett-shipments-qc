// ---- Status as icons: one small glyph per state, each in a solid round chip. Hover or long-press for the name. ----
export const G = {
  ring: <circle cx="8" cy="8" r="4.3" />,
  half: (
    <>
      <circle cx="8" cy="8" r="5" />
      <path d="M8 3a5 5 0 0 1 0 10z" fill="currentColor" stroke="none" />
    </>
  ),
  clipCheck: (
    <>
      <rect x="3.6" y="3" width="8.8" height="10.6" rx="1.6" />
      <path d="M6 3V2.4h4V3M5.9 8.4l1.6 1.6 2.8-3" />
    </>
  ),
  tag: (
    <>
      <path d="M2.8 8.3V3.6a.8.8 0 0 1 .8-.8h4.7l5 5a.8.8 0 0 1 0 1.1l-3.9 3.9a.8.8 0 0 1-1.1 0z" />
      <circle cx="5.7" cy="5.7" r=".5" fill="currentColor" />
    </>
  ),
  pen: <path d="M3 13l.7-2.8 6.6-6.6a1.4 1.4 0 0 1 2 2l-6.6 6.6zM9.2 4.8l2 2" />,
  check: <path d="M3.5 8.4 6.5 11.4l6-7" />,
  truck: (
    <>
      <path d="M1.8 4.4h7.4v6.2H1.8zM9.2 6.6h2.6l2 2.2v1.8H9.2" />
      <circle cx="4.6" cy="11.4" r="1.2" fill="#fff" />
      <circle cx="11.2" cy="11.4" r="1.2" fill="#fff" />
    </>
  ),
  pause: <path d="M6 4v8M10 4v8" />,
  x: <path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8" />,
  up: <path d="M8 12.6V3.8M4.2 7.4 8 3.6l3.8 3.8" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="5.4" />
      <path d="M8 5.2V8l1.9 1.2" />
    </>
  ),
  dbl: (
    <>
      <path d="M1.6 8.4 4.6 11.4l5.6-7" />
      <path d="M7 10.8l.6.6 6-7.4" />
    </>
  )
}

export const INK = '#12161c'
export const BLUE = '#2456c8'
export const TEAL = '#0f766e'
export const AMBER = '#b45309'
export const YELLOW = '#e5a00d'
export const GREEN = '#15803d'
export const DEEP_GREEN = '#0f5f2e'
export const RED = '#c2261b'
export const GREY = '#8a929d'

export const Glyph = ({ glyph, size }: { glyph: keyof typeof G; size: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {G[glyph]}
  </svg>
)
