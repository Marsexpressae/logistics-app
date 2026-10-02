// The Mars Express logo mark: an envelope whose flap forms the letter M.
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
      <rect width="136" height="136" rx="30" fill="#d9442a" />
      <polyline
        points="30,98 30,38 68,76 106,38 106,98 30,98"
        fill="none"
        stroke="#ffffff"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
