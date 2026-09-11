/** Section carte : titre + description + contenu. */
export default function Card({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800 sm:p-5">
      {title ? <h2 className="text-lg font-semibold">{title}</h2> : null}
      {description ? <p className="mt-1 text-sm text-zinc-500">{description}</p> : null}
      <div className={title || description ? "mt-4" : ""}>{children}</div>
    </section>
  );
}
