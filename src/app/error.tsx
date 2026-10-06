"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { reportError } from "@/lib/report-error";

// Shown inside the app (the menu stays) when something on a page breaks. The error is reported to the private
// error log (Settings > Problems), and the person can try again or go home.
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    void reportError(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
      <h1 className="mt-4 text-xl font-semibold text-slate-900">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">
        This page could not be shown. The problem has been reported. Your data is safe. Please try again, and if it keeps happening, tell your administrator.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <button onClick={() => retry()} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Try again
        </button>
        <Link href="/" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Go to the start
        </Link>
      </div>
    </div>
  );
}
