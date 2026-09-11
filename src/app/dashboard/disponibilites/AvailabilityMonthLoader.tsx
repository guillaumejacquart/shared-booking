"use client";

import dynamic from "next/dynamic";

const AvailabilityMonth = dynamic(() => import("./AvailabilityMonth"), {
  ssr: false,
  loading: () => <CalendarSkeleton />,
});

function CalendarSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <div className="h-8 w-48 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
      <div className="h-72 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
    </div>
  );
}

export default function AvailabilityMonthLoader({ practitionerId }: { practitionerId: string }) {
  return <AvailabilityMonth practitionerId={practitionerId} />;
}
