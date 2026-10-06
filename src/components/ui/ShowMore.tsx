import { Button } from "@/components/ui/form";
import { PAGE_SIZE } from "@/lib/window";

/** "Show 50 more": appears under a long list, with how many are still hidden. */
export default function ShowMore({ remaining, onClick, step = PAGE_SIZE, what = "more" }: { remaining: number; onClick: () => void; step?: number; what?: string }) {
  if (remaining <= 0) return null;
  return (
    <div className="mt-3 text-center">
      <Button variant="secondary" size="large" onClick={onClick}>
        Show {Math.min(step, remaining)} {what} ({remaining} hidden)
      </Button>
    </div>
  );
}
