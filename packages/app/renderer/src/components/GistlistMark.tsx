import { cn } from "../lib/utils";

export function GistlistMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      aria-hidden="true"
      className={cn("h-10 w-10 shrink-0", className)}
    >
      <defs>
        <linearGradient id="gistlist-mark-bg" x1="50%" x2="50%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="#2D6B3F" />
          <stop offset="100%" stopColor="#214F2F" />
        </linearGradient>
      </defs>

      <rect x="96" y="96" width="832" height="832" rx="196" fill="url(#gistlist-mark-bg)" />

      <g fill="#FFFFFF">
        <rect x="278" y="434" width="54" height="104" rx="27" />
        <rect x="376" y="369" width="54" height="234" rx="27" />
        <rect x="475" y="303" width="54" height="104" rx="27" />
        <rect x="475" y="540" width="54" height="127" rx="27" />
        <rect x="573" y="369" width="54" height="104" rx="27" />
        <rect x="486" y="395" width="52" height="130" rx="26" />
        <rect x="447" y="434" width="130" height="52" rx="26" />
        <rect x="589" y="470" width="76" height="188" rx="38" />
        <rect x="533" y="526" width="188" height="76" rx="38" />
        <circle cx="692" cy="455" r="30" />
      </g>
    </svg>
  );
}
