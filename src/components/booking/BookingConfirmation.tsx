import { t } from "@/lib/i18n";
import { googleCalendarTemplateUrl } from "@/lib/google-template";
import { fullFmt, timeFmt } from "@/lib/format";
import { buttonStyles } from "@/components/ui";
import type { SlotDto } from "@/hooks/useAvailableSlots";

export default function BookingConfirmation({
  sessionName,
  slot,
}: {
  sessionName: string | undefined;
  slot: SlotDto;
}) {
  const start = new Date(slot.startAt);
  const googleUrl = googleCalendarTemplateUrl({
    title: sessionName ?? "Rendez-vous",
    start,
    end: new Date(slot.endAt),
  });
  return (
    <section className="rounded-2xl border bg-ok-bg p-6 text-center text-ok">
      <h2 className="text-xl font-semibold">{t("booking.successTitle")}</h2>
      <p className="mt-2 font-medium">
        {sessionName} — {fullFmt.format(start)} à {timeFmt.format(start)}
      </p>
      <p className="mt-2 text-sm text-mist">{t("booking.successDetail")}</p>
      <p className="mt-4">
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-block ${buttonStyles("secondary")}`}
        >
          {t("booking.addToGoogle")}
        </a>
      </p>
    </section>
  );
}
