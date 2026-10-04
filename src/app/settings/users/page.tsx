"use client";

import { Fragment, useState, type FormEvent } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { Button, Card, ErrorMessage, Field, inputClass } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { useCurrentProfile, usePermissions } from "@/lib/profile-context";
import { formatDate } from "@/lib/format";
import { isMock, supabase } from "@/lib/supabase";
import { mockUsersApi } from "@/lib/mock-supabase";
import type { RoleRow } from "@/lib/types";

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  role: string | null;
  active: boolean;
  driver: string | null;
  last_sign_in_at: string | null;
};
type UsersResponse = { users: UserRow[]; unlinkedDrivers: { id: string; name: string }[] };

// Calls our server routes with the signed-in user's token; the server checks they hold users.manage.
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (isMock) return mockUsersApi(path, init) as T; // sample data mode: no server
  const { data } = await supabase.auth.getSession();
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as T;
}

export default function UsersPage() {
  const me = useCurrentProfile();
  const { can } = usePermissions();
  const isSuperAdmin = me.role === "super_admin";

  // Roles come from the database, so a new role (like Manager) appears here automatically.
  const rolesQuery = useQuery<RoleRow[]>(() => supabase.from("roles").select("*").order("sort"));
  const allRoles = rolesQuery.data ?? [];
  // Only a super admin can hand out the super admin role.
  const assignable = allRoles.filter((r) => isSuperAdmin || r.key !== "super_admin");
  const roleLabel = (key: string | null) => allRoles.find((r) => r.key === key)?.label ?? key ?? "No access";

  const users = useQuery<UsersResponse>(() =>
    api<UsersResponse>("/api/users").then(
      (data) => ({ data, error: null }),
      (e: Error) => ({ data: null, error: { message: e.message } })
    )
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [role, setRole] = useState("staff");
  const [busy, setBusy] = useState(false);
  // The person being edited (name and email), or null.
  // A role picked in the list but not saved yet.
  const [roleDraft, setRoleDraft] = useState<{ id: string; role: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; email: string } | null>(null);

  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      users.reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function addUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    await run(
      () =>
        api("/api/users", {
          method: "POST",
          body: JSON.stringify({
            full_name: f.get("full_name"),
            email: f.get("email"),
            password: f.get("password"),
            role,
            driver_id: f.get("driver_id") || null,
          }),
        }),
      `Added ${f.get("full_name")}. Share the email and temporary password with them.`
    );
    setBusy(false);
    form.reset();
    setRole("staff");
  }

  const patch = (id: string, body: object, success: string) =>
    run(() => api(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }), success);

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    const saved = await patch(editing.id, { full_name: editing.name, email: editing.email }, `Saved details for ${editing.name}.`);
    setBusy(false);
    if (saved) setEditing(null);
  }

  return (
    <>
      <PageHeader title="Users" description="Add people and choose their role. What each role can do is set under Roles & Permissions." />

      {isMock && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Sample data mode: these people are examples. Adding new users needs the real Supabase connection.
        </p>
      )}

      <Card title="Roles" className="mb-6">
        <dl className="space-y-2 text-sm">
          {allRoles.map((r) => (
            <div key={r.key} className="grid gap-1 sm:grid-cols-[11rem_1fr]">
              <dt className="font-medium">{r.label}</dt>
              <dd className="text-slate-600">{r.description}</dd>
            </div>
          ))}
        </dl>
        {can("roles.manage") && (
          <Link href="/settings/roles" className="mt-3 inline-block text-sm font-medium text-blue-700">
            Edit what each role can do →
          </Link>
        )}
      </Card>

      {!isMock && (
        <Card title="Add a user" className="mb-6">
          <form onSubmit={addUser} className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <input name="full_name" required className={inputClass} />
            </Field>
            <Field label="Email">
              <input name="email" type="email" required className={inputClass} />
            </Field>
            <Field label="Temporary password (min 8 characters)">
              <input name="password" type="text" required minLength={8} autoComplete="off" className={inputClass} />
            </Field>
            <Field label="Role">
              <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
                {assignable.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            {role === "driver" && (
              <Field label="Driver record">
                <select name="driver_id" defaultValue="" className={inputClass}>
                  <option value="">Create a new driver record</option>
                  {users.data?.unlinkedDrivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      Link to existing: {d.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Adding…" : "Add user"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <ErrorMessage message={error ?? users.error} />
      {notice && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}

      {users.data && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Person</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last sign-in</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.data.users.map((u) => {
                const isMe = u.id === me.id;
                // Managers cannot modify a super admin.
                const locked = isMe || (!isSuperAdmin && u.role === "super_admin");
                const canEditPerson = isSuperAdmin || u.role !== "super_admin"; // managers cannot edit a super admin
                const isEditing = editing?.id === u.id;
                return (
                  <Fragment key={u.id}>
                  <tr>
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        {u.full_name || "—"} {isMe && <span className="text-xs text-slate-500">(you)</span>}
                      </p>
                      <p className="text-slate-500">{u.email}</p>
                      {u.driver && <p className="text-xs text-slate-500">Driver: {u.driver}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={`Role for ${u.email}`}
                        className={`${inputClass} w-auto`}
                        value={roleDraft?.id === u.id ? roleDraft.role : u.role ?? ""}
                        disabled={locked}
                        onChange={(e) => setRoleDraft(e.target.value === (u.role ?? "") ? null : { id: u.id, role: e.target.value })}
                      >
                        {!u.role && <option value="">No access</option>}
                        {u.role && !assignable.some((r) => r.key === u.role) && (
                          <option value={u.role}>{roleLabel(u.role)}</option>
                        )}
                        {assignable.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      {roleDraft?.id === u.id && (
                        <span className="ml-2 inline-flex gap-2">
                          <Button
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              if (await patch(u.id, { role: roleDraft.role }, `Role updated for ${u.email}`)) setRoleDraft(null);
                              setBusy(false);
                            }}
                          >
                            Save
                          </Button>
                          <Button variant="secondary" onClick={() => setRoleDraft(null)}>
                            Cancel
                          </Button>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          u.role && u.active ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {!u.role ? "No access" : u.active ? "Active" : "Deactivated"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {u.last_sign_in_at ? formatDate(u.last_sign_in_at) : "Never"}
                    </td>
                    <td className="space-x-3 whitespace-nowrap px-4 py-3 text-right">
                      {canEditPerson && (
                        <button
                          className="text-blue-700"
                          onClick={() => setEditing(isEditing ? null : { id: u.id, name: u.full_name, email: u.email })}
                        >
                          {isEditing ? "Close" : "Edit"}
                        </button>
                      )}
                      {(!locked || isMe) && (
                        <button
                          className="text-blue-700"
                          onClick={() => {
                            const pw = prompt(`New password for ${u.email} (min 8 characters):`);
                            if (pw) patch(u.id, { password: pw }, `Password changed for ${u.email}`);
                          }}
                        >
                          Reset password
                        </button>
                      )}
                      {!locked && (
                        <button
                          className={u.active && u.role ? "text-red-600" : "text-blue-700"}
                          onClick={() =>
                            patch(
                              u.id,
                              { active: !(u.active && u.role) },
                              u.active && u.role ? `${u.email} deactivated` : `${u.email} activated`
                            )
                          }
                        >
                          {u.active && u.role ? "Deactivate" : "Activate"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {isEditing && editing && (
                    <tr className="bg-slate-50">
                      <td colSpan={5} className="px-4 py-4">
                        <form onSubmit={saveEdit} className="grid max-w-2xl gap-3 sm:grid-cols-2">
                          <Field label="Full name">
                            <input
                              required
                              value={editing.name}
                              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                              className={inputClass}
                            />
                          </Field>
                          <Field label="Email (they sign in with this)">
                            <input
                              required
                              type="email"
                              value={editing.email}
                              onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                              className={inputClass}
                            />
                          </Field>
                          {u.driver && (
                            <p className="text-xs text-slate-500 sm:col-span-2">
                              This person is a driver: their name on pickups and booking forms will change too.
                            </p>
                          )}
                          <div className="flex gap-2 sm:col-span-2">
                            <Button type="submit" disabled={busy}>
                              {busy ? "Saving…" : "Save"}
                            </Button>
                            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                              Cancel
                            </Button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
