"use client";

import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import BookingForm from "@/components/bookings/BookingForm";

export default function NewBookingPage() {
  const router = useRouter();

  return (
    <>
      <PageHeader title="New booking" description="A booking code like BK-1001 is generated automatically." />
      <BookingForm
        submitLabel="Create booking"
        onSaved={(code) => {
          alert(`Booking ${code} created`);
          router.push("/bookings");
        }}
      />
    </>
  );
}
