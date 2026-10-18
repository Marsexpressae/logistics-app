"use client";

import { Suspense, useState, type FormEvent } from "react";
import BadgeGrid from "@/components/rewards/BadgeGrid";
import PointsList from "@/components/rewards/PointsList";
import ProfileEditor from "@/components/rewards/ProfileEditor";
import ProfileHeader from "@/components/rewards/ProfileHeader";
import PageHeader from "@/components/ui/PageHeader";
import { Button, Card, ErrorMessage, Field, Notice, inputClass } from "@/components/ui/form";
import { checkNewPassword } from "@/lib/password";
import { useCurrentProfile } from "@/lib/profile-context";
import { useQuery, useSession } from "@/lib/hooks";
import type { BadgeView, DirectoryPerson, Rewards } from "@/lib/rewards";
import { supabase } from "@/lib/supabase";

/** Everyone's own page: your profile, points and badges, and changing your own password. */
function AccountPage() {
  const profile = useCurrentProfile();
  const session = useSession();
  const email = session?.user.email ?? "";
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const people = useQuery<DirectoryPerson[]>(() => supabase.rpc("people_directory") as never);
  const rewards = useQuery<Rewards>(() => supabase.rpc("my_rewards") as never);
  const badges = useQuery<BadgeView[]>(() => supabase.rpc("my_badges") as never);
  const me = people.data?.find((p) => p.id === profile.id) ?? null;

  async function change(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const current = String(f.get("current") ?? "");
    const next = String(f.get("next") ?? "");
    const confirm = String(f.get("confirm") ?? "");
    setDone(false);
    const problem = checkNewPassword(current, next, confirm, email);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    // Prove it is really you first (a phone left unlocked should not be enough to take over the account).
    const check = await supabase.auth.signInWithPassword({ email, password: current });
    if (check.error) {
      setBusy(false);
      return setError("Your current password is not right.");
    }
    const { error } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (error) return setError(error.message);
    form.reset();
    setDone(true);
  }

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="My profile" description="Your points and badges, your details, and your password." />

      {me && <ProfileHeader person={me} rewards={rewards.data} />}

      <Card title="My badges">
        <BadgeGrid badges={badges.data ?? []} />
      </Card>

      <Card title="My recent points">
        <PointsList lines={rewards.data?.recent ?? []} />
      </Card>

      {me && (
        <Card title="Edit my profile">
          <ProfileEditor key={`${me.photo_path}-${me.about}-${me.phone}`} person={me} onSaved={people.reload} />
        </Card>
      )}

      <Card title="You">
        <dl className="space-y-2 text-base">
          <div>
            <dt className="text-sm text-slate-600">Name</dt>
            <dd className="font-medium">{profile.full_name || "—"}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">Email (you sign in with this)</dt>
            <dd className="break-all font-medium">{email || "—"}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">Role</dt>
            <dd className="font-medium">{profile.roleLabel}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-slate-600">To change your name or email, ask a manager.</p>
      </Card>

      <Card title="Change my password">
        <form onSubmit={change} className="space-y-4" noValidate>
          <Field label="Current password">
            <input name="current" type={show ? "text" : "password"} autoComplete="current-password" required className={inputClass} />
          </Field>
          <Field label="New password (at least 8 characters)">
            <input name="next" type={show ? "text" : "password"} autoComplete="new-password" required minLength={8} className={inputClass} />
          </Field>
          <Field label="New password again">
            <input name="confirm" type={show ? "text" : "password"} autoComplete="new-password" required className={inputClass} />
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-base text-slate-800">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-6 w-6" />
            Show the passwords while I type
          </label>
          <ErrorMessage message={error} />
          {done && <Notice>Your password was changed. Use the new one the next time you sign in.</Notice>}
          <Button type="submit" size="large" disabled={busy}>
            {busy ? "Changing…" : "Change my password"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AccountPage />
    </Suspense>
  );
}
