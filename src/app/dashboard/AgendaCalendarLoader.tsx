"use client";

import dynamic from "next/dynamic";

const AgendaCalendar = dynamic(() => import("./AgendaCalendar"), {
  ssr: false,
  loading: () => <CalendarSkeleton />,
});

function CalendarSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <div className="h-8 w-48 animate-pulse rounded-full bg-wash" />
      <div className="h-72 animate-pulse rounded-2xl bg-wash" />
    </div>
  );
}

export default function AgendaCalendarLoader() {
  return <AgendaCalendar />;
}
