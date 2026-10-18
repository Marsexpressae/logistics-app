"use client";

import { useState, type FormEvent } from "react";
import { Camera } from "lucide-react";
import { Button, ErrorMessage, Field, Notice, inputClass } from "@/components/ui/form";
import { shrinkImage } from "@/lib/image";
import type { DirectoryPerson } from "@/lib/rewards";
import { supabase } from "@/lib/supabase";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Your own photo, birthday, about line and phone. Team, job title and joined date are changed by a manager. */
export default function ProfileEditor({ person, onSaved }: { person: DirectoryPerson; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [day, setDay] = useState(person.birthday_day ? String(person.birthday_day) : "");
  const [month, setMonth] = useState(person.birthday_month ? String(person.birthday_month) : "");
  const [hide, setHide] = useState(person.hide_birthday);
  const [about, setAbout] = useState(person.about ?? "");
  const [phone, setPhone] = useState(person.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    setError(null);
    if (Boolean(day) !== Boolean(month)) return setError("Enter both the day and the month of your birthday, or leave both empty.");
    setBusy(true);
    let photoPath: string | null = null;
    if (file) {
      photoPath = `${person.id}/avatar-${Date.now()}.jpg`;
      const up = await supabase.storage.from("staff-photos").upload(photoPath, await shrinkImage(file, 512), { contentType: "image/jpeg" });
      if (up.error) {
        setBusy(false);
        return setError(up.error.message);
      }
    }
    const { error } = await supabase.rpc("update_my_profile", {
      p_photo_path: photoPath,
      p_birthday_day: day ? Number(day) : null,
      p_birthday_month: month ? Number(month) : null,
      p_hide_birthday: hide,
      p_about: about,
      p_phone: phone,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setFile(null);
    setSaved(true);
    onSaved();
  }

  return (
    <form onSubmit={save} className="space-y-4" noValidate>
      <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 text-sm text-slate-700">
        <Camera className="h-4 w-4" aria-hidden="true" />
        {file ? file.name : "Choose a photo of yourself"}
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Birthday: day">
          <input value={day} onChange={(e) => setDay(e.target.value)} type="number" min={1} max={31} inputMode="numeric" className={inputClass} />
        </Field>
        <Field label="Birthday: month">
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass}>
            <option value="">—</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-base text-slate-800">
        <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} className="h-6 w-6" />
        Hide my birthday from colleagues
      </label>
      <Field label="About me (up to 200 characters)">
        <textarea value={about} onChange={(e) => setAbout(e.target.value)} maxLength={200} rows={2} className={inputClass} />
      </Field>
      <Field label="My phone (only managers can see it)">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" className={inputClass} />
      </Field>
      <ErrorMessage message={error} />
      {saved && <Notice>Saved</Notice>}
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save my profile"}
      </Button>
    </form>
  );
}
