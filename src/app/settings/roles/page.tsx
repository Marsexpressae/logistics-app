"use client";

import { Fragment, useState } from "react";
import { Lock } from "lucide-react";
import Chip from "@/components/ui/Chip";
import Disclosure, { DisclosureButton } from "@/components/ui/Disclosure";
import PageHeader from "@/components/ui/PageHeader";
import { Button, ErrorMessage, Loading } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { PermissionRow, RoleRow } from "@/lib/types";

type Matrix = { roles: RoleRow[]; permissions: PermissionRow[]; granted: Set<string> };

const cell = (role: string, permission: string) => `${role}|${permission}`;

export default function RolesPage() {
  const matrix = useQuery<Matrix>(async () => {
    const [roles, permissions, grants] = await Promise.all([
      supabase.from("roles").select("*").order("sort"),
      supabase.from("permissions").select("*").order("sort"),
      supabase.from("role_permissions").select("role, permission"),
    ]);
    const error = roles.error ?? permissions.error ?? grants.error;
    if (error) return { data: null, error };
    return {
      data: {
        roles: roles.data as RoleRow[],
        permissions: permissions.data as PermissionRow[],
        granted: new Set((grants.data as { role: string; permission: string }[]).map((g) => cell(g.role, g.permission))),
      },
      error: null,
    };
  });
  const [error, setError] = useState<string | null>(null);
  // Ticks are only collected here; nothing is saved until the Save button is pressed.
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());
  const [saving, setSaving] = useState(false);
  const [roleKey, setRoleKey] = useState<string | null>(null); // phones: the role being edited

  function toggle(role: string, permission: string, on: boolean) {
    const key = cell(role, permission);
    const next = new Map(pending);
    if (matrix.data?.granted.has(key) === on) next.delete(key); // back to how it was: not a change
    else next.set(key, on);
    setPending(next);
  }

  async function saveAll() {
    setSaving(true);
    setError(null);
    // Every access rule in the system reads from this table.
    for (const [key, on] of pending) {
      const [role, permission] = key.split("|");
      const { error } = on
        ? await supabase.from("role_permissions").insert({ role, permission })
        : await supabase.from("role_permissions").delete().eq("role", role).eq("permission", permission);
      if (error) {
        setError(error.message);
        break;
      }
      pending.delete(key);
    }
    setPending(new Map(pending));
    setSaving(false);
    matrix.reload();
  }

  const m = matrix.data;
  const groups = m ? [...new Set(m.permissions.map((p) => p.group_name))] : [];

  // Groups (General, Bookings, Pickups ...) open and close. They start closed so a long list is easy to scan;
  // a group with unsaved ticks shows how many, so nothing is lost behind a closed group.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (g: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (!next.delete(g)) next.add(g);
      return next;
    });
  const allOpen = groups.length > 0 && groups.every((g) => openGroups.has(g));
  const groupOf = (permission: string) => m?.permissions.find((p) => p.key === permission)?.group_name;
  const unsavedIn = (g: string) => [...pending.keys()].filter((k) => groupOf(k.split("|")[1]) === g).length;
  const unsavedBadge = (g: string) =>
    unsavedIn(g) > 0 ? <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium normal-case text-brand-800">{unsavedIn(g)} unsaved</span> : null;

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="Choose what each role can do. Tick or untick, then press Save changes. It applies to everyone with that role (they may need to refresh)."
      />
      <ErrorMessage message={error ?? matrix.error} />
      {m && (
        <div className="mb-3">
          <Button variant="secondary" onClick={() => setOpenGroups(allOpen ? new Set() : new Set(groups))}>
            {allOpen ? "Close all groups" : "Open all groups"}
          </Button>
        </div>
      )}

      {matrix.loading || !m ? (
        <Loading />
      ) : (
        <>
        {/* Phones: pick a role, then switch its permissions on or off. Wide screens: the grid below. */}
        <div className="md:hidden">
          <div role="group" aria-label="Role" className="mb-3 flex flex-wrap gap-2">
            {m.roles.map((r) => (
              <Chip key={r.key} active={(roleKey ?? m.roles[0].key) === r.key} onClick={() => setRoleKey(r.key)}>
                {r.label}
              </Chip>
            ))}
          </div>
          {(() => {
            const role = m.roles.find((r) => r.key === (roleKey ?? m.roles[0].key)) ?? m.roles[0];
            const locked = role.key === "super_admin"; // the super admin always keeps everything
            return (
              <>
                <p className="mb-3 text-base text-slate-700">
                  {role.description}
                  {locked && (
                    <span className="mt-1 flex items-center gap-1 text-sm text-slate-600">
                      <Lock className="h-4 w-4" aria-hidden="true" /> Locked on purpose, so you can never lock yourself out.
                    </span>
                  )}
                </p>
                {groups.map((group) => (
                  <Disclosure
                    key={group}
                    variant="bar"
                    className="mb-3"
                    title={group}
                    meta={`${m.permissions.filter((p) => p.group_name === group && (role.key === "super_admin" || (pending.get(cell(role.key, p.key)) ?? m.granted.has(cell(role.key, p.key))))).length} of ${m.permissions.filter((p) => p.group_name === group).length} on`}
                    badge={unsavedBadge(group)}
                    open={openGroups.has(group)}
                    onToggle={() => toggleGroup(group)}
                  >
                    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-300 bg-white">
                      {m.permissions
                        .filter((p) => p.group_name === group)
                        .map((p) => {
                          const key = cell(role.key, p.key);
                          return (
                            <li key={p.key}>
                              <label className="flex min-h-16 items-center justify-between gap-3 px-4 py-3">
                                <span className="min-w-0">
                                  <span className="block text-base font-medium">{p.label}</span>
                                  <span className="block text-sm text-slate-600">{p.description}</span>
                                </span>
                                <input
                                  type="checkbox"
                                  className="h-7 w-7 shrink-0 accent-brand-600"
                                  checked={locked || (pending.get(key) ?? m.granted.has(key))}
                                  disabled={locked || saving}
                                  aria-label={`${role.label}: ${p.label}`}
                                  onChange={(e) => toggle(role.key, p.key, e.target.checked)}
                                />
                              </label>
                            </li>
                          );
                        })}
                    </ul>
                  </Disclosure>
                ))}
              </>
            );
          })()}
        </div>

        <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Permission</th>
                {m.roles.map((r) => (
                  <th key={r.key} className="px-3 py-3 text-center" title={r.description}>
                    {r.label}
                    {r.key === "super_admin" && <Lock className="ml-1 inline h-3 w-3" aria-label="locked" />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group}>
                  <tr className="bg-slate-50">
                    <td colSpan={m.roles.length + 1} className="px-2 py-1 text-xs font-semibold uppercase text-slate-500">
                      <DisclosureButton open={openGroups.has(group)} onToggle={() => toggleGroup(group)} className="px-2 uppercase">
                        {group}
                        <span className="font-normal normal-case text-slate-500">({m.permissions.filter((p) => p.group_name === group).length})</span>
                        {unsavedBadge(group)}
                      </DisclosureButton>
                    </td>
                  </tr>
                  {m.permissions
                    .filter((p) => p.group_name === group && openGroups.has(group))
                    .map((p) => (
                      <tr key={p.key} className="border-t border-slate-100">
                        <td className="px-4 py-2.5">
                          <p className="font-medium">{p.label}</p>
                          <p className="text-xs text-slate-500">{p.description}</p>
                        </td>
                        {m.roles.map((r) => {
                          const key = cell(r.key, p.key);
                          const locked = r.key === "super_admin"; // the super admin always keeps everything
                          return (
                            <td key={r.key} className="p-0 text-center">
                              <label className="flex h-11 min-w-11 cursor-pointer items-center justify-center">
                                <input
                                  type="checkbox"
                                  className="h-5 w-5 accent-brand-600"
                                  checked={locked || (pending.get(key) ?? m.granted.has(key))}
                                  disabled={locked || saving}
                                  aria-label={`${r.label}: ${p.label}`}
                                  onChange={(e) => toggle(r.key, p.key, e.target.checked)}
                                />
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {pending.size > 0 && (
        <div className="sticky bottom-16 mt-3 flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm md:bottom-4">
          <span>
            {pending.size} unsaved {pending.size === 1 ? "change" : "changes"}
          </span>
          <span className="flex gap-2">
            <Button variant="secondary" onClick={() => setPending(new Map())} disabled={saving}>
              Discard
            </Button>
            <Button onClick={saveAll} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </span>
        </div>
      )}

      <p className="mt-3 max-w-3xl text-xs text-slate-500">
        The Super admin column is locked on purpose, so you can never lock yourself out. Every change here is recorded on the
        Activity page.
      </p>
    </>
  );
}
