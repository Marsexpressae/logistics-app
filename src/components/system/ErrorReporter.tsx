"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";

/** Listens for errors that happen anywhere in the app and reports them to the private error log. Shows nothing. */
export default function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => void reportError(e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => void reportError(e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
