"use client";

import { Suspense } from "react";
import AddBadgeForm from "@/components/rewards/AddBadgeForm";
import BadgesTable, { type BadgeRow } from "@/components/rewards/BadgesTable";
import GiveForm from "@/components/rewards/GiveForm";
import LevelsTable from "@/components/rewards/LevelsTable";
import RulesTable, { type PointRule } from "@/components/rewards/RulesTable";
import StaffDetailsTable from "@/components/rewards/StaffDetailsTable";
import BackLink from "@/components/ui/BackLink";
import PageHeader from "@/components/ui/PageHeader";
import { Card, ErrorMessage, Loading } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import type { Level } from "@/lib/rewards";
import { supabase } from "@/lib/supabase";

/** Thank-yous and badges for colleagues, and (for managers of the system) the point values, levels and badges. */
function RewardsSettings() {
  const { can } = usePermissions();
  const rules = useQuery<PointRule[]>(() => supabase.from("point_rules").select("*").order("key") as never);
  const levels = useQuery<Level[]>(() => supabase.from("levels").select("*").order("number") as never);
  const badges = useQuery<BadgeRow[]>(() => supabase.from("badges").select("*").order("key") as never);
  const manual = (badges.data ?? []).filter((b) => b.kind === "manual" && b.active).map((b) => ({ key: b.key, name: b.name }));

  if (rules.loading || levels.loading || badges.loading) return <Loading />;
  return (
    <div className="max-w-4xl space-y-4">
      <BackLink href="/settings">Back to Settings</BackLink>
      <PageHeader title="Rewards" description="Thank your colleagues, and set how points, levels and badges work." />
      <ErrorMessage message={rules.error ?? levels.error ?? badges.error} />

      {can("rewards.give") && (
        <Card title="Thank a colleague">
          <p className="mb-3 text-sm text-slate-600">Your thank-yous and badges show on their profile and in the team wins. There is a monthly limit on thank-yous.</p>
          <GiveForm manualBadges={manual} onGiven={() => {}} />
        </Card>
      )}

      {can("rewards.manage") && (
        <>
          <Card title="What earns points">
            <p className="mb-3 text-sm text-slate-600">Real work is counted by the app itself. The daily limit stops anyone collecting too many points from one thing in a day.</p>
            <RulesTable rules={rules.data ?? []} onSaved={rules.reload} />
          </Card>
          <Card title="Levels">
            <p className="mb-3 text-sm text-slate-600">Each level needs more points than the one before. A level follows total points, so raising a number can move people down a level.</p>
            <LevelsTable levels={levels.data ?? []} onSaved={levels.reload} />
          </Card>
          {can("users.manage") && (
            <Card title="Teams and job titles">
              <p className="mb-3 text-sm text-slate-600">The team decides which badges a person can earn: sales badges for the sales team, pickup badges for the pickup team.</p>
              <StaffDetailsTable />
            </Card>
          )}
          <Card title="Badges">
            <p className="mb-3 text-sm text-slate-600">A badge that is already earned stays earned, even if you change its goal.</p>
            <BadgesTable badges={badges.data ?? []} onSaved={badges.reload} />
          </Card>
          <Card title="Add a badge">
            <p className="mb-3 text-sm text-slate-600">Make a new badge for the whole team. Badges in a family show as medals of growing colour.</p>
            <AddBadgeForm rules={(rules.data ?? []).map((r) => ({ key: r.key, label: r.label }))} families={[...new Set((badges.data ?? []).map((b) => b.family).filter((f): f is string => !!f))]} onAdded={badges.reload} />
          </Card>
        </>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RewardsSettings />
    </Suspense>
  );
}
