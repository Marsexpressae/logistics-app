"use client";

import { Fragment, useState, type FormEvent } from "react";
import Link from "next/link";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import { Button, Card, ErrorMessage, Field, inputClass } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { useCurrentProfile, usePermissions } from "@/lib/profile-context";
import ListSearch from "@/components/ui/ListSearch";
import { matchesSearch } from "@/lib/search";
import { formatDate } from "@/lib/format";
import { isMock, supabase } from "@/lib/supabase";
import { mockUsersApi } from "@/lib/mock-supabase";
import type { RoleRow } from "@/lib/types";
import { askText } from "@/lib/ask";

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
  const [find, setFind] = useState("");
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
          <Link href="/settings/roles" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-brand-700">
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
      {notice && <p role="status" className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}

      {users.data && (
        <div className="mb-3">
          <ListSearch value={find} onChange={setFind} placeholder="Name, email or role" />
        </div>
      )}

      {users.data &&
        (() => {
          const people = users.data.users.filter((u) => matchesSearch(find, [u.full_name, u.email, roleLabel(u.role), u.driver]));
          // What this person may do to each user: managers cannot modify a super admin, and nobody locks themselves out.
          const flags = (u: UserRow) => {
            const isMe = u.id === me.id;
            const locked = isMe || (!isSuperAdmin && u.role === "super_admin");
            return { isMe, locked, canEditPerson: isSuperAdmin || u.role !== "super_admin", isEditing: editing?.id === u.id };
          };
          const status = (u: UserRow) => (
            <span
              className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${
                u.role && u.active ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-700"
              }`}
            >
              {!u.role ? "No access" : u.active ? "Active" : "Deactivated"}
            </span>
          );
          const roleControl = (u: UserRow, locked: boolean) => (
            <>
              <select
                aria-label={`Role for ${u.email}`}
                className={`${inputClass} w-auto`}
                value={roleDraft?.id === u.id ? roleDraft.role : u.role ?? ""}
                disabled={locked}
                onChange={(e) => setRoleDraft(e.target.value === (u.role ?? "") ? null : { id: u.id, role: e.target.value })}
              >
                {!u.role && <option value="">No access</option>}
                {u.role && !assignable.some((r) => r.key === u.role) && <option value={u.role}>{roleLabel(u.role)}</option>}
                {assignable.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
              {roleDraft?.id === u.id && (
                <span className="mt-2 flex gap-2 sm:ml-2 sm:mt-0 sm:inline-flex">
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
            </>
          );
          const resetPassword = async (u: UserRow) => {
            const pw = await askText({
              title: `New password for ${u.email}`,
              field: { label: "New password (at least 8 characters)", secret: true, minLength: 8 },
              confirmLabel: "Change password",
            });
            if (pw) patch(u.id, { password: pw }, `Password changed for ${u.email}`);
          };
          const toggleActive = (u: UserRow) =>
            patch(u.id, { active: !(u.active && u.role) }, u.active && u.role ? `${u.email} deactivated` : `${u.email} activated`);
          const editForm = (u: UserRow) =>
            editing && (
              <form onSubmit={saveEdit} className="grid max-w-2xl gap-3 sm:grid-cols-2">
                <Field label="Full name">
                  <input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputClass} />
                </Field>
                <Field label="Email (they sign in with this)">
                  <input required type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} className={inputClass} />
                </Field>
                {u.driver && <p className="text-sm text-slate-600 sm:col-span-2">This person is a driver: their name on pickups and booking forms will change too.</p>}
                <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row">
                  <Button type="submit" disabled={busy}>
                    {busy ? "Saving…" : "Save"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            );

          if (!people.length) return <EmptyState message={find.trim() ? "No one matches your search." : "No users yet."} />;

          return (
            <>
              {/* Phones: one card per person, with big buttons. Wide screens: the table below. */}
              <ul className="space-y-3 md:hidden">
                {people.map((u) => {
                  const { isMe, locked, canEditPerson, isEditing } = flags(u);
                  return (
                    <li key={u.id} className="rounded-lg border border-slate-300 bg-white p-4">
                      <p className="text-lg font-semibold">
                        {u.full_name || "—"} {isMe && <span className="text-sm font-normal text-slate-600">(you)</span>}
                      </p>
                      <p className="break-all text-base text-slate-700">{u.email}</p>
                      {u.driver && <p className="text-sm text-slate-600">Driver: {u.driver}</p>}
                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {status(u)}
                        <span className="text-sm text-slate-600">Last sign-in: {u.last_sign_in_at ? formatDate(u.last_sign_in_at) : "never"}</span>
                      </p>
                      <div className="mt-3">{roleControl(u, locked)}</div>
                      <div className="mt-3 flex flex-col gap-2">
                        {canEditPerson && (
                          <Button variant="secondary" className="w-full" onClick={() => setEditing(isEditing ? null : { id: u.id, name: u.full_name, email: u.email })}>
                            {isEditing ? "Close" : "Edit name and email"}
                          </Button>
                        )}
                        {(!locked || isMe) && (
                          <Button variant="secondary" className="w-full" onClick={() => resetPassword(u)}>
                            Reset password
                          </Button>
                        )}
                        {!locked && (
                          <Button variant="secondary" className={`w-full ${u.active && u.role ? "text-red-700" : ""}`} onClick={() => toggleActive(u)}>
                            {u.active && u.role ? "Deactivate" : "Activate"}
                          </Button>
                        )}
                      </div>
                      {isEditing && <div className="mt-3 rounded-md bg-slate-50 p-3">{editForm(u)}</div>}
                    </li>
                  );
                })}
              </ul>

              <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
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
                    {people.map((u) => {
                      const { isMe, locked, canEditPerson, isEditing } = flags(u);
                      return (
                        <Fragment key={u.id}>
                          <tr>
                            <td className="px-4 py-3">
                              <p className="font-medium">
                                {u.full_name || "—"} {isMe && <span className="text-xs text-slate-600">(you)</span>}
                              </p>
                              <p className="text-slate-600">{u.email}</p>
                              {u.driver && <p className="text-xs text-slate-600">Driver: {u.driver}</p>}
                            </td>
                            <td className="px-4 py-3">{roleControl(u, locked)}</td>
                            <td className="px-4 py-3">{status(u)}</td>
                            <td className="px-4 py-3 text-slate-600">{u.last_sign_in_at ? formatDate(u.last_sign_in_at) : "Never"}</td>
                            <td className="space-x-1 whitespace-nowrap px-4 py-3 text-right">
                              {canEditPerson && (
                                <button className="min-h-11 px-2 text-brand-700" onClick={() => setEditing(isEditing ? null : { id: u.id, name: u.full_name, email: u.email })}>
                                  {isEditing ? "Close" : "Edit"}
                                </button>
                              )}
                              {(!locked || isMe) && (
                                <button className="min-h-11 px-2 text-brand-700" onClick={() => resetPassword(u)}>
                                  Reset password
                                </button>
                              )}
                              {!locked && (
                                <button className={`min-h-11 px-2 ${u.active && u.role ? "text-red-700" : "text-brand-700"}`} onClick={() => toggleActive(u)}>
                                  {u.active && u.role ? "Deactivate" : "Activate"}
                                </button>
                              )}
                            </td>
                          </tr>
                          {isEditing && (
                            <tr className="bg-slate-50">
                              <td colSpan={5} className="px-4 py-4">
                                {editForm(u)}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          );
        })()}
    </>
  );
}
