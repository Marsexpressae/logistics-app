"use client";

import { Fragment, useState } from "react";
import { Lock } from "lucide-react";
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

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="Choose what each role can do. Tick or untick, then press Save changes. It applies to everyone with that role (they may need to refresh)."
      />
      <ErrorMessage message={error ?? matrix.error} />

      {matrix.loading || !m ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
                    <td colSpan={m.roles.length + 1} className="px-4 py-2 text-xs font-semibold uppercase text-slate-500">
                      {group}
                    </td>
                  </tr>
                  {m.permissions
                    .filter((p) => p.group_name === group)
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
                            <td key={r.key} className="px-3 py-2.5 text-center">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-blue-600"
                                checked={locked || (pending.get(key) ?? m.granted.has(key))}
                                disabled={locked || saving}
                                aria-label={`${r.label}: ${p.label}`}
                                onChange={(e) => toggle(r.key, p.key, e.target.checked)}
                              />
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
      )}

      {pending.size > 0 && (
        <div className="sticky bottom-16 mt-3 flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm md:bottom-4">
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
