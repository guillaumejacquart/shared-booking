import { getDashboardContext } from "@/lib/dashboard";
import DashboardNav from "./DashboardNav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getDashboardContext();
  return (
    <div className="flex min-h-full flex-col">
      <DashboardNav ctx={ctx} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
