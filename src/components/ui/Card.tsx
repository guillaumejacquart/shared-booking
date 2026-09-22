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
    <section className="rounded-3xl border border-line bg-card p-4 shadow-soft sm:p-6">
      {title ? <h2 className="text-lg font-semibold">{title}</h2> : null}
      {description ? <p className="mt-1 text-sm text-mist">{description}</p> : null}
      <div className={title || description ? "mt-4" : ""}>{children}</div>
    </section>
  );
}
