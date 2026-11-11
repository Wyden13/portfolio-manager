/** Stroke icons drawn on a 16px grid; they take the text colour. */
const PATHS = {
  search: <><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></>,
  menu: <path d="M2 4h12M2 8h12M2 12h12" />,
  close: <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />,
  sun: <><circle cx="8" cy="8" r="3" /><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" /></>,
  moon: <path d="M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7z" />,
  sync: <><path d="M13.5 6.5A5.5 5.5 0 0 0 3.2 5M2.5 9.5A5.5 5.5 0 0 0 12.8 11" /><path d="M3 2v3h3M13 14v-3h-3" /></>,
  check: <path d="M3 8.5l3 3 7-7" />,
  chevronDown: <path d="M4 6l4 4 4-4" />,
  chevronRight: <path d="M6 4l4 4-4 4" />,
  back: <path d="M10 3L5 8l5 5" />,
  download: <path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 13.5h11" />,
  star: <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />,
  starFilled: <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="currentColor" />,
  bell: <><path d="M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11z" /><path d="M6.5 14h3" /></>,
  link: <><path d="M6.5 9.5l3-3" /><path d="M7 4.5l1.3-1.3a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.3 1.3a2.5 2.5 0 0 1-3.5-3.5L5.5 8" /></>,
  list: <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.5M2.5 8h.5M2.5 12h.5" />,
  home: <path d="M2.5 7.5L8 3l5.5 4.5V13.5h-11z" />,
  user: <><circle cx="8" cy="5.5" r="2.5" /><path d="M3 14c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" /></>,
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter">
      {PATHS[name]}
    </svg>
  )
}

/** The InvestIQ mark: an accent square with a bar and a rising line, in the theme's colours. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="icon">
      <rect width="64" height="64" rx="14" fill="var(--acc)" />
      <rect x="14" y="17" width="8" height="30" rx="1.5" fill="var(--on)" />
      <path d="M29 45 L36.5 34 L42 39.5 L50 24" fill="none" stroke="var(--on)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
