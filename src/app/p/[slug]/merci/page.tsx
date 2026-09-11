import MerciClient from "./MerciClient";

export default async function MerciPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <MerciClient slug={slug} />;
}
