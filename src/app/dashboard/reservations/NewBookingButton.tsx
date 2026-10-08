"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import type { ManualFormData } from "@/services/bookings";
import ManualBookingModal from "@/components/booking/ManualBookingModal";
import { Button } from "@/components/ui";

/** Bouton « Nouvelle réservation » : ouvre la saisie manuelle en modale. */
export default function NewBookingButton({ formData }: { formData: ManualFormData }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("reservations.newBooking")}</Button>
      <ManualBookingModal
        formData={formData}
        open={open}
        initialStartAt={null}
        onClose={() => setOpen(false)}
        onCreated={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
