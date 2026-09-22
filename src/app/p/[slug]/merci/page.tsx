import { getPractitionerPage } from "@/dal/practitioners";
import { parseMode, parsePalette } from "@/lib/theme";
import MerciClient from "./MerciClient";

export default async function MerciPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await getPractitionerPage(slug);
  return (
    <div
      data-palette={parsePalette(page?.office.themePalette)}
      data-mode={parseMode(page?.office.themeMode)}
      className="flex min-h-full flex-1 flex-col bg-surface text-ink"
    >
      <MerciClient slug={slug} />
    </div>
  );
}
