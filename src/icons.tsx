import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

export const ArrowUp = (p: P) => (
  <svg {...base(p)} strokeWidth={2.6}>
    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
  </svg>
);
export const Sparkles = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M10 2.5c.4 0 .7.3.8.7l.9 3.4a5 5 0 0 0 3.6 3.6l3.4.9a.8.8 0 0 1 0 1.6l-3.4.9a5 5 0 0 0-3.6 3.6l-.9 3.4a.8.8 0 0 1-1.6 0l-.9-3.4a5 5 0 0 0-3.6-3.6l-3.4-.9a.8.8 0 0 1 0-1.6l3.4-.9a5 5 0 0 0 3.6-3.6l.9-3.4c.1-.4.4-.7.8-.7Z" />
    <path d="M18.5 1.5c.2 0 .4.1.4.3l.3 1.1c.2.7.7 1.2 1.4 1.4l1.1.3a.4.4 0 0 1 0 .8l-1.1.3c-.7.2-1.2.7-1.4 1.4l-.3 1.1a.4.4 0 0 1-.8 0l-.3-1.1c-.2-.7-.7-1.2-1.4-1.4l-1.1-.3a.4.4 0 0 1 0-.8l1.1-.3c.7-.2 1.2-.7 1.4-1.4l.3-1.1c0-.2.2-.3.4-.3Z" />
  </svg>
);
export const Person = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <circle cx="12" cy="8" r="4.2" />
    <path d="M3.8 20.2c.9-4 4.2-6.2 8.2-6.2s7.3 2.2 8.2 6.2c.1.5-.3.8-.8.8H4.6c-.5 0-.9-.3-.8-.8Z" />
  </svg>
);
export const Trash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.2A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.8L18 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />
  </svg>
);
export const Check = (p: P) => (
  <svg {...base(p)} strokeWidth={2.8}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
export const Undo = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);
export const Wave = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" />
  </svg>
);
export const Bolt = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M13.2 2.6 5.4 13a.8.8 0 0 0 .6 1.3h4.8l-1.4 6.9c-.2.8.8 1.2 1.3.6l7.8-10.4a.8.8 0 0 0-.6-1.3h-4.8l1.4-6.9c.2-.8-.8-1.2-1.3-.6Z" />
  </svg>
);
export const Pill = (p: P) => (
  <svg {...base(p)}>
    <g transform="rotate(45 12 12)">
      <rect x="7.5" y="2.5" width="9" height="19" rx="4.5" />
      <path d="M7.5 12h9" />
      <path d="M8.2 12.6h7.6v4.4a3.8 3.8 0 0 1-7.6 0Z" fill="currentColor" stroke="none" />
    </g>
  </svg>
);
export const Moon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M20.3 14.6A8.5 8.5 0 0 1 9.4 3.7a.6.6 0 0 0-.8-.7 9.2 9.2 0 1 0 12.4 12.4.6.6 0 0 0-.7-.8Z" />
  </svg>
);
export const Clock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
export const Chart = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <path d="M5 20V12M12 20V5M19 20v-5" />
  </svg>
);
export const Plus = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const Close = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
  </svg>
);
export const ChevronLeft = (p: P) => (
  <svg {...base(p)} strokeWidth={2.6}>
    <path d="M15 5.5 8.5 12l6.5 6.5" />
  </svg>
);
export const ChevronRight = (p: P) => (
  <svg {...base(p)} strokeWidth={2.6}>
    <path d="M9 5.5 15.5 12 9 18.5" />
  </svg>
);
export const Location = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M20.6 3.4a.8.8 0 0 0-.9-.2L3.5 10.1c-.7.3-.6 1.3.1 1.5l6.6 2.2 2.2 6.6c.2.7 1.2.8 1.5.1l6.9-16.2c.1-.3 0-.7-.2-.9Z" />
  </svg>
);
export const Refresh = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
  </svg>
);
export const Download = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
  </svg>
);
export const Drop = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M12 2.8c.3 0 .5.1.7.4 2.2 3 6 7.7 6 11.3a6.7 6.7 0 0 1-13.4 0c0-3.6 3.8-8.3 6-11.3.2-.3.4-.4.7-.4Z" />
  </svg>
);

// 天気
export const Sky = ({ kind, ...p }: P & { kind: "sun" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm" }) => {
  const sun = (
    <g>
      <circle cx="12" cy="12" r="4.2" fill="#ffb800" stroke="none" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <path key={a} d="M12 3.2v2" stroke="#ffb800" strokeWidth="2" transform={`rotate(${a} 12 12)`} />
      ))}
    </g>
  );
  const cloud = (fill: string) => (
    <path d="M7.2 19h9.6a4.2 4.2 0 0 0 .4-8.4 5.6 5.6 0 0 0-10.6 1.6A3.4 3.4 0 0 0 7.2 19Z" fill={fill} stroke="none" />
  );
  return (
    <svg {...base(p)} strokeWidth={2}>
      {kind === "sun" && sun}
      {kind === "partly" && (
        <>
          <g transform="translate(-3 -3) scale(.85)">{sun}</g>
          <g transform="translate(2 1) scale(.9)">{cloud("#c7d2e0")}</g>
        </>
      )}
      {kind === "cloud" && cloud("#b8c3d1")}
      {kind === "fog" && (
        <>
          {cloud("#c9d1db")}
          <path d="M5 21.5h14" stroke="#9aa6b5" />
        </>
      )}
      {kind === "rain" && (
        <>
          <g transform="translate(0 -3)">{cloud("#9fb1c6")}</g>
          <path d="M8.5 19l-1 2.5M12.5 19l-1 2.5M16.5 19l-1 2.5" stroke="#3b9cff" />
        </>
      )}
      {kind === "snow" && (
        <>
          <g transform="translate(0 -3)">{cloud("#b8c3d1")}</g>
          <g fill="#7cc4ff" stroke="none">
            <circle cx="8" cy="20.5" r="1.2" />
            <circle cx="12" cy="21.5" r="1.2" />
            <circle cx="16" cy="20.5" r="1.2" />
          </g>
        </>
      )}
      {kind === "storm" && (
        <>
          <g transform="translate(0 -3)">{cloud("#8696aa")}</g>
          <path d="m12.5 16.5-2 3.2h3l-2 3.3" stroke="#ffb800" strokeWidth="1.8" />
        </>
      )}
    </svg>
  );
};

export const GoogleG = (p: P) => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden {...p}>
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.9-6.9C35.9 2.4 30.4 0 24 0 14.6 0 6.6 5.4 2.6 13.3l8 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.4 5.7c4.3-4 6.9-9.9 6.9-17.2z" />
    <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-8-6.2A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-8 6.1C6.6 42.6 14.6 48 24 48z" />
  </svg>
);
