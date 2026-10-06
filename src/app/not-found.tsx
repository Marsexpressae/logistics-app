import Link from "next/link";
import { SearchX } from "lucide-react";

// Shown when an address does not exist (a mistyped link, or an old bookmark).
export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <SearchX className="mx-auto h-10 w-10 text-slate-400" />
      <h1 className="mt-4 text-xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600">This page does not exist, or the link is old. Use the search box at the top to find what you need.</p>
      <Link href="/" className="mt-6 inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
        Go to the start
      </Link>
    </div>
  );
}
