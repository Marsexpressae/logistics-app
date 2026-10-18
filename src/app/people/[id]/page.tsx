"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import BadgeGrid from "@/components/rewards/BadgeGrid";
import PointsList from "@/components/rewards/PointsList";
import ProfileHeader from "@/components/rewards/ProfileHeader";
import BackLink from "@/components/ui/BackLink";
import { Card, ErrorMessage, Loading } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import type { BadgeView, DirectoryPerson, Rewards } from "@/lib/rewards";
import { supabase } from "@/lib/supabase";

/** A colleague's profile, read-only: their points, level and badges. No phone and no hidden birthday (the database leaves those out). */
function ColleaguePage() {
  const { id } = useParams<{ id: string }>();
  const people = useQuery<DirectoryPerson[]>(() => supabase.rpc("people_directory") as never);
  const rewards = useQuery<Rewards>(() => supabase.rpc("person_rewards", { p_person: id }) as never, [id]);
  const badges = useQuery<BadgeView[]>(() => supabase.rpc("person_badges_of", { p_person: id }) as never, [id]);
  const person = people.data?.find((p) => p.id === id) ?? null;

  if (people.loading) return <Loading />;
  if (!person) return <ErrorMessage message={people.error ?? "That person was not found."} />;
  return (
    <div className="max-w-2xl space-y-4">
      <BackLink href="/">Back to the dashboard</BackLink>
      <ProfileHeader person={person} rewards={rewards.data} />
      <Card title="Badges">
        <BadgeGrid badges={badges.data ?? []} />
      </Card>
      <Card title="Recent points">
        <PointsList lines={rewards.data?.recent ?? []} />
      </Card>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ColleaguePage />
    </Suspense>
  );
}
