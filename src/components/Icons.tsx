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
export const CoachIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden>
    <path d="M4 5h16v11H9l-5 4z" /><path d="M8 10h8" />
  </svg>
);
export const ShowcaseIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden>
    <rect x="3" y="12" width="4" height="8" rx="1" /><rect x="10" y="4" width="4" height="16" rx="1" /><rect x="17" y="9" width="4" height="11" rx="1" />
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
export const MedalIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden>
    <circle cx="12" cy="14" r="6" /><path d="M8.5 3.5L10.5 8.5M15.5 3.5L13.5 8.5" /><path d="M12 11.5v5" />
  </svg>
);
export const ArrowIcon = ({ dir = "up", ...p }: P & { dir?: "up" | "down" }) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden style={{ width: 18, height: 18, transform: dir === "down" ? "rotate(180deg)" : undefined }}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);
export const CloseIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const StethoscopeIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p} aria-hidden>
    <path d="M6 3v6a4 4 0 0 0 8 0V3" /><path d="M10 13v2a5 5 0 0 0 10 0v-2" /><circle cx="20" cy="11" r="2" />
  </svg>
);
