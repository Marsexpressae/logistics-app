"use client";

import { useParams } from "next/navigation";
import BrandMark from "@/components/brand/BrandMark";
import TrackingView from "@/components/tracking/TrackingView";
import { site } from "@/config/site";

// Public page: no login. Data comes from the track_booking() database function only.
export default function TrackingPage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code);

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-2 pt-2">
        <BrandMark size={32} />
        <div>
          <p className="text-sm font-semibold leading-tight text-brand-700">{site.name}</p>
          <h1 className="text-xl font-semibold leading-tight">Cargo tracking</h1>
        </div>
      </div>
      <TrackingView code={code} searchHref="/track" />
    </div>
  );
}
