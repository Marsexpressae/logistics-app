// The Mars Express logo mark: an orange cargo box whose edges form the letter M, on navy.
// Keep in sync with src/app/icons/[size]/route.tsx and src/app/icon.svg.
export default function BrandMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 136 136"
      role="img"
      aria-label="Mars Express"
      className={className}
    >
      <rect width="136" height="136" rx="30" fill="#0f172a" />
      <polygon points="68,24 106,45 68,66 30,45" fill="#fdba74" />
      <polygon points="30,45 68,66 68,112 30,91" fill="#f97316" />
      <polygon points="106,45 68,66 68,112 106,91" fill="#c2410c" />
      <polyline
        points="30,91 30,45 68,66 106,45 106,91"
        fill="none"
        stroke="#ffffff"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
