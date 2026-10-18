/** 全站同一套線條圖示：24px 方格、2.5px 粗線、圓頭圓角（docs/design.md） */
const PATHS = {
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </>
  ),
  exit: <path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14c1 1.6 2.4 2.4 4 2.4s3-.8 4-2.4" />
      <path d="M9 9.5v.5M15 9.5v.5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="M4 18l5-5 4 4 3-3 4 4" />
    </>
  ),
  send: <path d="M4 12L20 4l-5 16-3.5-6.5L4 12z" />,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  undo: (
    <>
      <path d="M9 7L4 12l5 5" />
      <path d="M4 12h10a6 6 0 010 8h-3" />
    </>
  ),
  translate: (
    <>
      <path d="M4 6h9M8.5 4v2M6 6c0 4 3 7 6 8M12 6c0 3-2.5 6.5-7 8" />
      <path d="M13 20l4-10 4 10M14.5 17h5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  wifiOff: <path d="M3 3l18 18M8.5 16.5a5 5 0 017 0M5 12.5a10 10 0 015-2.8M19 12.5a10 10 0 00-6-2.8M12 20h.01" />,
  alert: <path d="M12 3l10 18H2L12 3zM12 10v4M12 17.5v.5" />,
  check: <path d="M4 12l5 5L20 6" />,
  refresh: <path d="M20 12a8 8 0 11-2.4-5.7M20 4v5h-5" />,
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  spinner: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className, color = 'currentColor' }: { name: IconName; className?: string; color?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}

export function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

/** 像素風對話框 Logo */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 14 13" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M2 0h10v1h1v1h1v7h-1v1h-1v1H8v1H7v1H6v-1H5v-1H4v-1H2v-1H1v-1H0V2h1V1h1z" fill="var(--ink)" />
      <path d="M3 1h8v1h1v1h1v5h-1v1h-1v1H7v1H6v-1H5v-1H4v-1H3v-1H2v-1H1V3h1V2h1z" fill="var(--orange)" />
      <rect x="4" y="4" width="1" height="2" fill="var(--ink)" />
      <rect x="9" y="4" width="1" height="2" fill="var(--ink)" />
      <rect x="5" y="7" width="4" height="1" fill="var(--ink)" />
    </svg>
  );
}
