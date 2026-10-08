/**
 * Règlement sur place : moyens acceptés par le praticien (niveau praticien,
 * pas par séance) + précision libre, affichés aux patients pour les séances
 * à tarif affiché sans paiement en ligne.
 *
 * Stockage : `practitioner.onsite_payment_methods` (JSON : ["especes", …],
 * parsé par `parseOnsitePaymentMethods`) + `onsite_payment_note` (texte).
 */

/** Moyens proposés (ordre canonique d'affichage). */
export const ONSITE_PAYMENT_METHODS = ["especes", "carte", "virement", "cheque"] as const;
export type OnsitePaymentMethod = (typeof ONSITE_PAYMENT_METHODS)[number];

/** Libellés français (emails ; l'UI passe par `fr.json`, section `onsite`). */
export const ONSITE_METHOD_LABELS_FR: Record<OnsitePaymentMethod, string> = {
  especes: "espèces",
  carte: "carte bancaire",
  virement: "virement",
  cheque: "chèque",
};

export function isOnsitePaymentMethod(value: unknown): value is OnsitePaymentMethod {
  return (
    typeof value === "string" &&
    (ONSITE_PAYMENT_METHODS as readonly string[]).includes(value)
  );
}

/**
 * Parse tolérant du JSON stocké : entrées inconnues ignorées, doublons
 * retirés, ordre canonique (cases cochées hier dans un autre ordre restent
 * stables à l'affichage).
 */
export function parseOnsitePaymentMethods(raw: string | null | undefined): OnsitePaymentMethod[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const kept = new Set<OnsitePaymentMethod>();
    for (const item of parsed) {
      if (isOnsitePaymentMethod(item)) kept.add(item);
    }
    return ONSITE_PAYMENT_METHODS.filter((method) => kept.has(method));
  } catch {
    return [];
  }
}

/**
 * Énumération française (« espèces », « espèces et carte bancaire »,
 * « espèces, carte bancaire et virement »). Null si aucun moyen.
 */
export function formatOnsitePaymentMethods(
  methods: OnsitePaymentMethod[],
  labels: Record<OnsitePaymentMethod, string> = ONSITE_METHOD_LABELS_FR,
): string | null {
  const names = methods.map((method) => labels[method]);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

/** Montant nu (« 60 », « 59,90 », « 1 200 ») : espaces ignorés, 2 décimales max. */
const PLAIN_AMOUNT_RE = /^[0-9]+([.,][0-9]{1,2})?$/;

/**
 * Formate un montant nu avec la devise (« 60 » → « 60,00 € »), sinon null
 * (texte libre ou montant invalide : affiché tel quel par l'appelant).
 */
export function formatPlainAmount(
  priceDisplay: string,
  currency: string,
): string | null {
  const compact = priceDisplay.trim().replace(/\s/g, "");
  if (!PLAIN_AMOUNT_RE.test(compact)) return null;
  const amount = Number(compact.replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
}

/**
 * Prix « gratuit ou à définir » : "0", "0,00 €", "gratuit"… → aucun
 * règlement sur place à annoncer. "0" = tarif à définir (convention
 * `priceDisplay`) : pas de badge non plus, le montant est inconnu.
 */
export function isFreePriceDisplay(priceDisplay: string | null | undefined): boolean {
  if (!priceDisplay) return true;
  const compact = priceDisplay
    .trim()
    .toLowerCase()
    .replace(/[\s\u00a0\u202f€]/g, "")
    .replace(/euros?$/, "")
    .replace(/eur$/, "");
  if (compact === "") return true;
  if (/^(gratuite?s?|offerte?s?|free)$/.test(compact)) return true;
  const amount = Number(compact.replace(",", "."));
  return compact !== "" && Number.isFinite(amount) && amount === 0;
}

/**
 * Prix payable sur place : montant affiché non gratuit (« 60 € », « 60 »,
 * « à partir de 50 € »…), formaté avec la devise pour les montants nus.
 * Null si gratuit / à définir / absent.
 */
export function formatPayablePrice(
  priceDisplay: string | null | undefined,
  currency: string,
): string | null {
  if (!priceDisplay || isFreePriceDisplay(priceDisplay)) return null;
  return formatPlainAmount(priceDisplay, currency) ?? priceDisplay;
}
