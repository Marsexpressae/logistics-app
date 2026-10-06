type CountBadgeProps = {
  count: number;
  /** "dot" shows just a red dot (used when the number is hidden inside a menu). */
  variant?: "number" | "dot";
  className?: string;
  label?: string; // what the count means, for screen readers
};

/** A small red number bubble. Renders nothing when the count is zero. */
export default function CountBadge({ count, variant = "number", className = "", label = "waiting" }: CountBadgeProps) {
  if (count <= 0) return null;

  if (variant === "dot") {
    return (
      <span
        className={`block h-2.5 w-2.5 rounded-full bg-red-600 ring-2 ring-white ${className}`}
        role="img"
        aria-label={`${count} ${label}`}
      />
    );
  }

  return (
    <span
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold leading-none text-white ${className}`}
      role="img"
      aria-label={`${count} ${label}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
