"use client";

import { useState } from "react";
import { LocateFixed } from "lucide-react";
import { Button, Field, inputClass } from "@/components/ui/form";
import { AREAS } from "@/config/areas";
import { todayISO } from "@/lib/format";
import { formatGeo, mapsUrl, parseGeo } from "@/lib/geo";
import type { Booking, Driver } from "@/lib/types";

/**
 * Where, when and by whom the cargo is collected. A new booking opens as a form. A saved booking that already has a customer
 * reads as a summary until "Edit pickup details" is pressed. These are cells of the Card's grid, so the result is a fragment.
 */
export default function PickupSection({
  booking,
  onlyPickup,
  address,
  geoText,
  onGeoText,
  drivers,
  onError,
}: {
  booking?: Booking;
  onlyPickup: boolean; // the Customer card above already shows the customer, so this card is only "Pickup"
  address: { value: string; n: number }; // n changes to re-fill the address box when a customer is picked
  geoText: string;
  onGeoText: (v: string) => void;
  drivers: Driver[] | null;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [locating, setLocating] = useState(false);
  const summary = onlyPickup && !!booking && !editing;
  const geo = parseGeo(geoText);
  const geoInvalid = geoText.trim() !== "" && !geo;

  function useMyLocation() {
    if (!navigator.geolocation) return onError("This browser cannot share its location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onGeoText(formatGeo(pos.coords.latitude, pos.coords.longitude));
        setLocating(false);
      },
      () => {
        onError("Could not get your location. Allow location access, or paste coordinates instead.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <>
      <div className={onlyPickup ? "sm:col-span-2" : "border-t border-slate-100 pt-4 sm:col-span-2"}>
        {!onlyPickup && <h3 className="text-sm font-semibold text-slate-900">Pickup</h3>}
        <p className="text-xs text-slate-500">Where, when and by whom the customer&apos;s cargo is collected.</p>
      </div>

      {summary && booking && (
        <>
          <input type="hidden" name="pickup_area" value={booking.pickup_area ?? ""} />
          <input type="hidden" name="pickup_address" value={address.value} />
          <input type="hidden" name="driver_id" value={booking.driver_id ?? ""} />
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:col-span-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase text-slate-500">Area</dt>
              <dd className="text-base text-slate-900">{booking.pickup_area ?? "Not set"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-slate-500">Pickup date</dt>
              <dd className="text-base text-slate-900">{new Date(`${booking.pickup_date}T00:00:00`).toLocaleDateString("en-GB")}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase text-slate-500">Address</dt>
              <dd className="text-base text-slate-900">{address.value || "Not set"}</dd>
              {geo && (
                <a href={mapsUrl({ geo_lat: geo.lat, geo_lng: geo.lng, pickup_address: "" })} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline">
                  Open the pin on the map
                </a>
              )}
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-slate-500">Driver</dt>
              <dd className="text-base text-slate-900">{drivers?.find((d) => d.id === booking.driver_id)?.name ?? "Unassigned"}</dd>
            </div>
          </dl>
          <div className="sm:col-span-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              Edit pickup details
            </Button>
          </div>
        </>
      )}

      {!summary && (
        <>
          <Field label="Pickup area">
            <select name="pickup_area" required defaultValue={booking?.pickup_area ?? ""} className={inputClass}>
              <option value="" disabled>
                Select area…
              </option>
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pickup date">
            <input
              name="pickup_date"
              type="date"
              required
              readOnly={!!booking}
              defaultValue={booking?.pickup_date ?? todayISO()}
              className={`${inputClass} ${booking ? "cursor-not-allowed bg-slate-100 text-slate-600" : ""}`}
            />
            {booking && (
              <span className="mt-1 block text-xs text-slate-500">
                To move the pickup, use <strong>Reschedule</strong> above. A reason is required and the other team is told.
              </span>
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Pickup address">
              <textarea key={`a${address.n}`} name="pickup_address" required rows={2} defaultValue={address.value} className={inputClass} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Geo location (optional)">
              <div className="flex gap-2">
                <input value={geoText} onChange={(e) => onGeoText(e.target.value)} placeholder="25.2048, 55.2708 or a Google Maps link" className={`${inputClass} font-mono`} />
                <Button type="button" variant="secondary" onClick={useMyLocation} disabled={locating} className="shrink-0">
                  <LocateFixed className="h-4 w-4" />
                  <span className="hidden sm:inline">{locating ? "Locating…" : "Use my location"}</span>
                </Button>
              </div>
            </Field>
            {geoInvalid && (
              <p className="mt-1 text-xs text-red-600">
                Could not read coordinates. Short links (maps.app.goo.gl) do not contain them. Open the link, then copy the full address or coordinates.
              </p>
            )}
            {geo && (
              <a href={mapsUrl({ geo_lat: geo.lat, geo_lng: geo.lng, pickup_address: "" })} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-brand-700">
                Check pin on map ({formatGeo(geo.lat, geo.lng)})
              </a>
            )}
          </div>
          <Field label="Assigned driver">
            {/* key remounts the select once drivers load so the saved value is selected */}
            <select key={drivers ? "loaded" : "loading"} name="driver_id" className={inputClass} defaultValue={booking?.driver_id ?? ""}>
              <option value="">Unassigned</option>
              {drivers?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
    </>
  );
}
