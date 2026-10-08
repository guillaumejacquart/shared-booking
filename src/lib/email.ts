import nodemailer from "nodemailer";

import { env, isSmtpConfigured } from "./env";

/**
 * Emails (SPEC.md §F11). Sans SMTP configuré, les emails sont journalisés en
 * console (dev) au lieu d'être envoyés — le boot ne plante jamais.
 */

export interface IcsAttachment {
  filename: string;
  content: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  ics?: IcsAttachment;
}

export type SendEmail = (email: OutgoingEmail) => Promise<void>;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(bodyHtml: string): string {
  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">${bodyHtml}<hr style="border:none;border-top:1px solid #eee;margin-top:24px" /><p style="color:#888;font-size:12px">Pratique de bien-être non médicale — ce message ne constitue ni diagnostic ni ordonnance.</p></div>`;
}

/** "mardi 16 septembre à 09h00" (Europe/Paris). */
export function formatBookingFr(at: Date, timeZone: string): string {
  const date = new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(at);
  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  return `${date} à ${time}`;
}

function icsDate(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Pièce jointe calendrier (ICS) pour confirmation / report. */
export function buildIcs(args: {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  stamp: Date;
  organizerEmail?: string;
  attendeeEmail?: string;
}): IcsAttachment {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//shared-booking//FR",
    "BEGIN:VEVENT",
    `UID:${args.uid}@shared-booking`,
    `DTSTAMP:${icsDate(args.stamp)}`,
    `DTSTART:${icsDate(args.start)}`,
    `DTEND:${icsDate(args.end)}`,
    `SUMMARY:${escapeIcs(args.summary)}`,
  ];
  if (args.description) lines.push(`DESCRIPTION:${escapeIcs(args.description)}`);
  if (args.location) lines.push(`LOCATION:${escapeIcs(args.location)}`);
  if (args.organizerEmail) lines.push(`ORGANIZER:mailto:${args.organizerEmail}`);
  if (args.attendeeEmail) lines.push(`ATTENDEE:mailto:${args.attendeeEmail}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return { filename: "rendez-vous.ics", content: lines.join("\r\n") };
}

export interface BookingMailModel {
  practitionerName: string;
  sessionName: string;
  start: Date;
  timeZone: string;
  officeName: string;
  officeAddress?: string | null;
  manageUrl: string; // lien magique (annulation / report)
  /** Règlement sur place (null si gratuit, à définir ou payé en ligne). */
  onsitePayment?: OnsitePaymentLine | null;
}

/** Détail du règlement sur place, calculé une seule fois par `mailModel`. */
export interface OnsitePaymentLine {
  price: string;
  methods: string | null; // « espèces et carte bancaire » (libellés FR)
  note: string | null; // précision libre du praticien
}

/** Lignes texte du règlement sur place (vide si rien à annoncer). */
function onsitePaymentTextLines(line: OnsitePaymentLine | null | undefined): string[] {
  if (!line) return [];
  const lines = [
    `Règlement sur place : ${line.price}${line.methods ? ` (${line.methods})` : ""}.`,
  ];
  if (line.note) lines.push(`Précision : ${line.note}`);
  return lines;
}

/** Paragraphe(s) HTML du règlement sur place (vide si rien à annoncer). */
function onsitePaymentHtml(line: OnsitePaymentLine | null | undefined): string {
  if (!line) return "";
  const methods = line.methods ? ` (${escapeHtml(line.methods)})` : "";
  const note = line.note ? `<p>Précision : ${escapeHtml(line.note)}</p>` : "";
  return `<p>Règlement sur place : <strong>${escapeHtml(line.price)}</strong>${methods}.</p>${note}`;
}

/**
 * Modèle complet d'un email de rendez-vous : le modèle textuel plus ses
 * dérivés calendrier (ICS, lien Google Agenda). Tout est construit en une
 * seule fois par `mailModel` — les call sites n'assemblent jamais les pièces.
 */
export interface BookingMailPayload extends BookingMailModel {
  ics: IcsAttachment;
  googleUrl: string;
}

function when(model: BookingMailModel): string {
  return formatBookingFr(model.start, model.timeZone);
}

export function confirmationEmail(to: string, model: BookingMailPayload): OutgoingEmail {
  const subject = `Confirmation : ${model.sessionName} le ${when(model)}`;
  const text = [
    `Bonjour,`,
    ``,
    `Votre rendez-vous « ${model.sessionName} » avec ${model.practitionerName} est confirmé :`,
    `${when(model)}.`,
    model.officeAddress ? `Lieu : ${model.officeName}, ${model.officeAddress}.` : `Lieu : ${model.officeName}.`,
    ...onsitePaymentTextLines(model.onsitePayment),
    ``,
    `Ajouter à Google Agenda : ${model.googleUrl}`,
    ``,
    `Pour annuler ou reporter : ${model.manageUrl}`,
    ``,
    `À bientôt,`,
  ].join("\n");
  return {
    to,
    subject,
    text,
    html: layout(
      `<p>Bonjour,</p><p>Votre rendez-vous <strong>${escapeHtml(model.sessionName)}</strong> avec <strong>${escapeHtml(model.practitionerName)}</strong> est confirmé :<br /><strong>${escapeHtml(when(model))}</strong>.</p><p>Lieu : ${escapeHtml(model.officeAddress ? `${model.officeName}, ${model.officeAddress}` : model.officeName)}.</p>${onsitePaymentHtml(model.onsitePayment)}<p><a href="${escapeHtml(model.googleUrl)}">Ajouter à Google Agenda</a></p><p><a href="${escapeHtml(model.manageUrl)}">Annuler ou reporter</a></p><p>À bientôt,</p>`,
    ),
    ics: model.ics,
  };
}

export function reminderEmail(to: string, model: BookingMailModel): OutgoingEmail {
  const subject = `Rappel : ${model.sessionName} ${when(model)}`;
  const onsite = onsitePaymentTextLines(model.onsitePayment);
  const text = `Bonjour,\n\nPetit rappel : votre rendez-vous « ${model.sessionName} » avec ${model.practitionerName} a lieu ${when(model)}.${onsite.length > 0 ? `\n${onsite.join("\n")}` : ""}\n\nPour annuler ou reporter : ${model.manageUrl}\n\nÀ bientôt,`;
  return {
    to,
    subject,
    text,
    html: layout(
      `<p>Bonjour,</p><p>Petit rappel : votre rendez-vous <strong>${escapeHtml(model.sessionName)}</strong> avec <strong>${escapeHtml(model.practitionerName)}</strong> a lieu <strong>${escapeHtml(when(model))}</strong>.</p>${onsitePaymentHtml(model.onsitePayment)}<p><a href="${escapeHtml(model.manageUrl)}">Annuler ou reporter</a></p><p>À bientôt,</p>`,
    ),
  };
}

export function patientCancelledEmail(
  to: string, // email du praticien
  model: BookingMailModel & { patientName: string },
): OutgoingEmail {
  const subject = `Annulation : ${model.sessionName} le ${when(model)}`;
  const text = `Bonjour ${model.practitionerName},\n\n${model.patientName} a annulé son rendez-vous « ${model.sessionName} » prévu ${when(model)}.\n\nLe créneau est de nouveau réservable.`;
  return {
    to,
    subject,
    text,
    html: layout(
      `<p>Bonjour ${escapeHtml(model.practitionerName)},</p><p><strong>${escapeHtml(model.patientName)}</strong> a annulé son rendez-vous <strong>${escapeHtml(model.sessionName)}</strong> prévu <strong>${escapeHtml(when(model))}</strong>.</p><p>Le créneau est de nouveau réservable.</p>`,
    ),
  };
}

/** RDV créé mais en attente de validation du praticien (sans paiement). */
export function validationPendingEmail(to: string, model: BookingMailModel): OutgoingEmail {
  const subject = `Demande reçue : ${model.sessionName} le ${when(model)}`;
  const onsite = onsitePaymentTextLines(model.onsitePayment);
  const text = `Bonjour,\n\nVotre demande de rendez-vous « ${model.sessionName} » avec ${model.practitionerName} (${when(model)}) est bien reçue.\nLe praticien va la valider et vous recevrez une confirmation par email.${onsite.length > 0 ? `\n${onsite.join("\n")}` : ""}\n\nPour annuler : ${model.manageUrl}`;
  return {
    to,
    subject,
    text,
    html: layout(
      `<p>Bonjour,</p><p>Votre demande de rendez-vous <strong>${escapeHtml(model.sessionName)}</strong> avec <strong>${escapeHtml(model.practitionerName)}</strong> (${escapeHtml(when(model))}) est bien reçue.</p><p>Le praticien va la valider et vous recevrez une confirmation par email.</p>${onsitePaymentHtml(model.onsitePayment)}<p><a href="${escapeHtml(model.manageUrl)}">Annuler la demande</a></p>`,
    ),
  };
}

/** Paiement reçu mais validation praticien encore requise. */
export function paymentReceivedEmail(to: string, model: BookingMailModel): OutgoingEmail {
  const subject = `Paiement reçu : ${model.sessionName} le ${when(model)}`;
  const text = `Bonjour,\n\nVotre paiement pour « ${model.sessionName} » avec ${model.practitionerName} (${when(model)}) est bien reçu.\nLe praticien va valider votre rendez-vous et vous recevrez une confirmation par email.\n\nPour annuler : ${model.manageUrl}`;
  return {
    to,
    subject,
    text,
    html: layout(
      `<p>Bonjour,</p><p>Votre paiement pour <strong>${escapeHtml(model.sessionName)}</strong> avec <strong>${escapeHtml(model.practitionerName)}</strong> (${escapeHtml(when(model))}) est bien reçu.</p><p>Le praticien va valider votre rendez-vous et vous recevrez une confirmation par email.</p><p><a href="${escapeHtml(model.manageUrl)}">Annuler</a></p>`,
    ),
  };
}

/** Nouvelle demande à valider (envoyé au praticien). */
export function validationRequestEmail(
  to: string, // email du praticien
  model: BookingMailModel & { patientName: string },
): OutgoingEmail {
  const subject = `À valider : ${model.sessionName} le ${when(model)}`;
  const text = `Bonjour ${model.practitionerName},\n\n${model.patientName} demande un rendez-vous « ${model.sessionName} » le ${when(model)}.\n\nValidez ou refusez depuis votre agenda.`;
  return {
    to,
    subject,
    text,
    html: layout(
      `<p>Bonjour ${escapeHtml(model.practitionerName)},</p><p><strong>${escapeHtml(model.patientName)}</strong> demande un rendez-vous <strong>${escapeHtml(model.sessionName)}</strong> le <strong>${escapeHtml(when(model))}</strong>.</p><p>Validez ou refusez depuis votre agenda.</p>`,
    ),
  };
}

export function practitionerCancelledEmail(
  to: string, // email du patient
  model: BookingMailModel & { reason: string },
): OutgoingEmail {
  const subject = `Annulation de votre rendez-vous du ${when(model)}`;
  const text = `Bonjour,\n\n${model.practitionerName} a dû annuler votre rendez-vous « ${model.sessionName} » prévu ${when(model)}.\nMotif : ${model.reason}\n\nMerci de reprendre rendez-vous si besoin : ${model.manageUrl}`;
  return {
    to,
    subject,
    text,
    html: layout(
      `<p>Bonjour,</p><p>${escapeHtml(model.practitionerName)} a dû annuler votre rendez-vous <strong>${escapeHtml(model.sessionName)}</strong> prévu <strong>${escapeHtml(when(model))}</strong>.</p><p>Motif : ${escapeHtml(model.reason)}</p>`,
    ),
  };
}

/** Lien de réinitialisation du mot de passe (token Better Auth, 1h). */
export function passwordResetEmail(to: string, url: string): OutgoingEmail {
  const subject = "Réinitialisation de votre mot de passe";
  const text = [
    `Bonjour,`,
    ``,
    `Vous avez demandé la réinitialisation de votre mot de passe.`,
    `Cliquez sur ce lien (valable 1 heure) : ${url}`,
    ``,
    `Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
  ].join("\n");
  return {
    to,
    subject,
    text,
    html: layout(
      `<p>Bonjour,</p><p>Vous avez demandé la réinitialisation de votre mot de passe.</p><p><a href="${escapeHtml(url)}">Choisir un nouveau mot de passe</a> (lien valable 1 heure).</p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>`,
    ),
  };
}

export function rescheduledEmail(to: string, model: BookingMailPayload): OutgoingEmail {
  const subject = `Report : ${model.sessionName} déplacé au ${when(model)}`;
  const onsite = onsitePaymentTextLines(model.onsitePayment);
  const text = `Bonjour,\n\nVotre rendez-vous « ${model.sessionName} » avec ${model.practitionerName} est reporté au ${when(model)}.${onsite.length > 0 ? `\n${onsite.join("\n")}` : ""}\n\nAjouter à Google Agenda : ${model.googleUrl}\n\nPour annuler ou reporter : ${model.manageUrl}\n\nÀ bientôt,`;
  return {
    to,
    subject,
    text,
    html: layout(
      `<p>Bonjour,</p><p>Votre rendez-vous <strong>${escapeHtml(model.sessionName)}</strong> avec <strong>${escapeHtml(model.practitionerName)}</strong> est reporté au <strong>${escapeHtml(when(model))}</strong>.</p>${onsitePaymentHtml(model.onsitePayment)}<p><a href="${escapeHtml(model.googleUrl)}">Ajouter à Google Agenda</a></p><p><a href="${escapeHtml(model.manageUrl)}">Annuler ou reporter</a></p><p>À bientôt,</p>`,
    ),
    ics: model.ics,
  };
}

/** Expéditeur SMTP avec nom convivial (Gmail affiche le nom, pas `contact`). */
export function mailFrom(): { name: string; address: string } {
  return { name: env.EMAIL_FROM_NAME, address: env.EMAIL_FROM };
}

/** Envoi réel (SMTP) ou journalisation (dev sans SMTP). */
export function createMailer(): SendEmail {
  if (!isSmtpConfigured) {
    return async (email) => {
      console.log(
        `[email:dev] to=${email.to} subject=${email.subject}\n${email.text}`,
      );
    };
  }
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
  });
  return async (email) => {
    await transport.sendMail({
      from: mailFrom(),
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      ...(email.ics
        ? {
            icalEvent: {
              filename: email.ics.filename,
              method: "REQUEST" as const,
              content: email.ics.content,
            },
          }
        : {}),
    });
  };
}
