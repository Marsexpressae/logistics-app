"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Package } from "lucide-react";
import InstallBanner from "@/components/pwa/InstallBanner";
import { site } from "@/config/site";
import { supabase, isMock } from "@/lib/supabase";
import { Button, ErrorMessage, Field, inputClass } from "@/components/ui/form";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace("/");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
      <InstallBanner className="w-full max-w-sm" />
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <Package className="h-6 w-6 text-blue-600" />
          <div>
            <p className="text-lg font-semibold leading-tight">{site.name}</p>
            <h1 className="text-sm text-slate-500">Sign in to continue</h1>
          </div>
        </div>
        {isMock && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Mock data mode: any email and password will work.
          </p>
        )}
        <Field label="Email">
          <input type="email" required className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input type="password" required className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorMessage message={error} />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
