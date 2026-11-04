type P = { className?: string };
const base = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const WeekIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden>
    <rect x="3" y="9" width="7" height="6" rx="1.5" /><rect x="11" y="9" width="5" height="6" rx="1.5" /><path d="M18 9h3v6h-3" strokeDasharray="2 2" />
  </svg>
);
export const PlanIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden>
    <path d="M4 6h10M4 12h16M4 18h7" /><circle cx="18" cy="6" r="2" /><circle cx="15" cy="18" r="2" />
  </svg>
);
export const ChatIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden>
    <path d="M4 5h16v11H9l-5 4z" /><path d="M8 10h8" />
  </svg>
);
export const GearIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
export const SettingsIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" />
  </svg>
);
export const PlusIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden><path d="M12 5v14M5 12h14" /></svg>
);
export const SyncIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden>
    <path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" /><path d="M20 20v-4h-4" />
  </svg>
);
export const SendIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden><path d="M5 12h13M13 6l6 6-6 6" /></svg>
);
export const ChevronIcon = ({ open, ...p }: P & { open?: boolean }) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 160ms", width: 20, height: 20 }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const WatchIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden style={{ width: 24, height: 24 }}>
    <rect x="6" y="6" width="12" height="12" rx="3" /><path d="M9 6V3h6v3M9 18v3h6v-3M9 12h2l1-2 1 4 1-2h1" />
  </svg>
);
export const TodayIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden>
    <circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
  </svg>
);
/** Progress tab: a trophy outline */
export const ProgressIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden>
    <path d="M8 4h8v5a4 4 0 0 1-8 0z" /><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4" /><path d="M12 13v4M8.5 20h7M10 17h4" />
  </svg>
);
export const CameraIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
  </svg>
);
export const PlayIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...p} aria-hidden><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
);
export const ArrowIcon = ({ dir = "up", ...p }: P & { dir?: "up" | "down" }) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden style={{ width: 18, height: 18, transform: dir === "down" ? "rotate(180deg)" : undefined }}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);
export const CloseIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
);
/** Summary tab: a clipboard with a small chart */
export const SummaryIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden>
    <rect x="5" y="4.5" width="14" height="16" rx="2" /><path d="M9 3h6v3H9z" /><path d="M8.5 16.5v-2.5M12 16.5v-5M15.5 16.5v-3.5" />
  </svg>
);
export const PencilIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden>
    <path d="M14.5 5.5l4 4" /><path d="M4 20l1-4.5L16 4.5a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2L8.5 19z" />
  </svg>
);
export const BackIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
);
