"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button, inputClass } from "@/components/ui/form";
import { site } from "@/config/site";

export default function TrackSearchPage() {
  const router = useRouter();
  const [code, setCode] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (code.trim()) router.push(`/track/${encodeURIComponent(code.trim().toUpperCase())}`);
  }

  return (
    <div className="mx-auto w-full max-w-md p-6 pt-20">
      <p className="mb-1 text-sm font-medium text-blue-700">{site.name}</p>
      <h1 className="mb-1 text-2xl font-semibold">Track your cargo</h1>
      <p className="mb-4 text-sm text-slate-500">Enter your invoice number or booking code, e.g. INV-1001.</p>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="INV-1001 or BK-1001" className={`${inputClass} font-mono`} />
        <Button type="submit">
          <Search className="h-4 w-4" /> Track
        </Button>
      </form>
    </div>
  );
}
