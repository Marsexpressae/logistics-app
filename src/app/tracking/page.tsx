"use client";

import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import TrackingView from "@/components/tracking/TrackingView";
import { Button, inputClass } from "@/components/ui/form";

// Staff view of the same tracking result customers see on the public link.
export default function TrackingSearchPage() {
  const [text, setText] = useState("");
  const [code, setCode] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (text.trim()) setCode(text.trim().toUpperCase());
  }

  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title="Tracking" description="Look up a job by invoice number or booking code, as your customer sees it." />
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="INV-1001 or BK-1001"
          aria-label="Invoice number or booking code"
          className={`${inputClass} font-mono`}
        />
        <Button type="submit">
          <Search className="h-4 w-4" /> Track
        </Button>
      </form>
      {code && <TrackingView code={code} searchHref="/tracking" />}
    </div>
  );
}
