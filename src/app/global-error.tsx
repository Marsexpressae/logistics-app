"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";

// The last safety net: if the whole app shell breaks, this replaces it. It brings its own page and plain styling,
// because the normal layout is not available here.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    void reportError(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8fafc", color: "#0f172a" }}>
        <div style={{ maxWidth: 420, margin: "0 auto", padding: "96px 24px", textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#475569", fontSize: 14, lineHeight: 1.5 }}>
            The app could not start. Your data is safe. Please try again, and if it keeps happening, tell your administrator.
          </p>
          <button
            onClick={() => retry()}
            style={{ marginTop: 16, padding: "10px 18px", background: "#2563eb", color: "#fff", border: 0, borderRadius: 6, fontSize: 14, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
