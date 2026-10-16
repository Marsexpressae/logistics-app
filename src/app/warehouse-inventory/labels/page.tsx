"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import BackLink from "@/components/ui/BackLink";
import ParcelLabel from "@/components/ui/ParcelLabel";
import { Button, ErrorMessage, Loading } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { Parcel } from "@/lib/types";

/** Labels for chosen parcels (the ones a merge, split or add just made): /warehouse-inventory/labels?ids=a,b */
function LabelsContent() {
  const ids = (useSearchParams().get("ids") ?? "").split(",").filter(Boolean);
  const canPrint = usePermissions().can("documents.print");
  const parcels = useQuery<Parcel[]>(() => supabase.from("parcels").select("*, warehouse:warehouses(code)").in("id", ids).order("barcode"), [ids.join(",")]);

  if (parcels.loading) return <Loading />;
  if (!parcels.data?.length) return <ErrorMessage message={parcels.error ?? "No parcels to print."} />;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex justify-between print:hidden">
        <BackLink href="/warehouse-inventory?tab=packed">Warehouse</BackLink>
        {canPrint && (
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print labels
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {parcels.data.map((p) => (
          <ParcelLabel key={p.id} barcode={p.barcode} description={p.description} weightKg={p.weight_kg} warehouse={p.warehouse?.code} />
        ))}
      </div>
    </div>
  );
}

export default function LabelsPage() {
  return (
    <Suspense fallback={null}>
      <LabelsContent />
    </Suspense>
  );
}
