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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(bodyHtml: string): string {
  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">${bodyHtml}<hr style="border:none;border-top:1px solid #eee;margin-top:24px" /><p style="color:#888;font-size:12px">Pratique de bien-être non médicale — ce message ne constitue ni diagnostic ni ordonnance.</p></div>`;
}

/** "mardi 16 septembre à 09h00" (Europe/Paris). */
export function formatBookingFr(d: Date, timeZone: string): string {
  const date = new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${date} à ${time}`;
}

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Pièce jointe calendrier (ICS) pour confirmation / report. */
export function buildIcs(args: {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  organizerEmail?: string;
  attendeeEmail?: string;
}): IcsAttachment {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//shared-booking//FR",
    "BEGIN:VEVENT",
    `UID:${args.uid}@shared-booking`,
    `DTSTAMP:${icsDate(new Date())}`,
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
}

function when(m: BookingMailModel): string {
  return formatBookingFr(m.start, m.timeZone);
}

export function confirmationEmail(
  to: string,
  m: BookingMailModel,
  ics: IcsAttachment,
): OutgoingEmail {
  const subject = `Confirmation : ${m.sessionName} le ${when(m)}`;
  const text = [
    `Bonjour,`,
    ``,
    `Votre rendez-vous « ${m.sessionName} » avec ${m.practitionerName} est confirmé :`,
    `${when(m)}.`,
    m.officeAddress ? `Lieu : ${m.officeName}, ${m.officeAddress}.` : `Lieu : ${m.officeName}.`,
    ``,
    `Pour annuler ou reporter : ${m.manageUrl}`,
    ``,
    `À bientôt,`,
  ].join("\n");
  return {
    to,
    subject,
    text,
    html: layout(
      `<p>Bonjour,</p><p>Votre rendez-vous <strong>${escapeHtml(m.sessionName)}</strong> avec <strong>${escapeHtml(m.practitionerName)}</strong> est confirmé :<br /><strong>${escapeHtml(when(m))}</strong>.</p><p>Lieu : ${escapeHtml(m.officeAddress ? `${m.officeName}, ${m.officeAddress}` : m.officeName)}.</p><p><a href="${escapeHtml(m.manageUrl)}">Annuler ou reporter</a></p><p>À bientôt,</p>`,
    ),
    ics,
  };
}

export function reminderEmail(to: string, m: BookingMailModel): OutgoingEmail {
  const subject = `Rappel : ${m.sessionName} ${when(m)}`;
  const text = `Bonjour,\n\nPetit rappel : votre rendez-vous « ${m.sessionName} » avec ${m.practitionerName} a lieu ${when(m)}.\n\nPour annuler ou reporter : ${m.manageUrl}\n\nÀ bientôt,`;
  return {
    to,
    subject,
    text,
    html: layout(
      `<p>Bonjour,</p><p>Petit rappel : votre rendez-vous <strong>${escapeHtml(m.sessionName)}</strong> avec <strong>${escapeHtml(m.practitionerName)}</strong> a lieu <strong>${escapeHtml(when(m))}</strong>.</p><p><a href="${escapeHtml(m.manageUrl)}">Annuler ou reporter</a></p><p>À bientôt,</p>`,
    ),
  };
}

export function patientCancelledEmail(
  to: string, // email du praticien
  m: BookingMailModel & { patientName: string },
): OutgoingEmail {
  const subject = `Annulation : ${m.sessionName} le ${when(m)}`;
  const text = `Bonjour ${m.practitionerName},\n\n${m.patientName} a annulé son rendez-vous « ${m.sessionName} » prévu ${when(m)}.\n\nLe créneau est de nouveau réservable.`;
  return {
    to,
    subject,
    text,
    html: layout(
      `<p>Bonjour ${escapeHtml(m.practitionerName)},</p><p><strong>${escapeHtml(m.patientName)}</strong> a annulé son rendez-vous <strong>${escapeHtml(m.sessionName)}</strong> prévu <strong>${escapeHtml(when(m))}</strong>.</p><p>Le créneau est de nouveau réservable.</p>`,
    ),
  };
}

/** RDV créé mais en attente de validation du praticien (sans paiement). */
export function validationPendingEmail(to: string, m: BookingMailModel): OutgoingEmail {
  const subject = `Demande reçue : ${m.sessionName} le ${when(m)}`;
  const text = `Bonjour,\n\nVotre demande de rendez-vous « ${m.sessionName} » avec ${m.practitionerName} (${when(m)}) est bien reçue.\nLe praticien va la valider et vous recevrez une confirmation par email.\n\nPour annuler : ${m.manageUrl}`;
  return {
    to,
    subject,
    text,
    html: layout(
      `<p>Bonjour,</p><p>Votre demande de rendez-vous <strong>${escapeHtml(m.sessionName)}</strong> avec <strong>${escapeHtml(m.practitionerName)}</strong> (${escapeHtml(when(m))}) est bien reçue.</p><p>Le praticien va la valider et vous recevrez une confirmation par email.</p><p><a href="${escapeHtml(m.manageUrl)}">Annuler la demande</a></p>`,
    ),
  };
}

/** Paiement reçu mais validation praticien encore requise. */
export function paymentReceivedEmail(to: string, m: BookingMailModel): OutgoingEmail {
  const subject = `Paiement reçu : ${m.sessionName} le ${when(m)}`;
  const text = `Bonjour,\n\nVotre paiement pour « ${m.sessionName} » avec ${m.practitionerName} (${when(m)}) est bien reçu.\nLe praticien va valider votre rendez-vous et vous recevrez une confirmation par email.\n\nPour annuler : ${m.manageUrl}`;
  return {
    to,
    subject,
    text,
    html: layout(
      `<p>Bonjour,</p><p>Votre paiement pour <strong>${escapeHtml(m.sessionName)}</strong> avec <strong>${escapeHtml(m.practitionerName)}</strong> (${escapeHtml(when(m))}) est bien reçu.</p><p>Le praticien va valider votre rendez-vous et vous recevrez une confirmation par email.</p><p><a href="${escapeHtml(m.manageUrl)}">Annuler</a></p>`,
    ),
  };
}

export function practitionerCancelledEmail(
  to: string, // email du patient
  m: BookingMailModel & { reason: string },
): OutgoingEmail {
  const subject = `Annulation de votre rendez-vous du ${when(m)}`;
  const text = `Bonjour,\n\n${m.practitionerName} a dû annuler votre rendez-vous « ${m.sessionName} » prévu ${when(m)}.\nMotif : ${m.reason}\n\nMerci de reprendre rendez-vous si besoin : ${m.manageUrl}`;
  return {
    to,
    subject,
    text,
    html: layout(
      `<p>Bonjour,</p><p>${escapeHtml(m.practitionerName)} a dû annuler votre rendez-vous <strong>${escapeHtml(m.sessionName)}</strong> prévu <strong>${escapeHtml(when(m))}</strong>.</p><p>Motif : ${escapeHtml(m.reason)}</p>`,
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

export function rescheduledEmail(
  to: string,
  m: BookingMailModel,
  ics: IcsAttachment,
): OutgoingEmail {
  const subject = `Report : ${m.sessionName} déplacé au ${when(m)}`;
  const text = `Bonjour,\n\nVotre rendez-vous « ${m.sessionName} » avec ${m.practitionerName} est reporté au ${when(m)}.\n\nPour annuler ou reporter : ${m.manageUrl}\n\nÀ bientôt,`;
  return {
    to,
    subject,
    text,
    html: layout(
      `<p>Bonjour,</p><p>Votre rendez-vous <strong>${escapeHtml(m.sessionName)}</strong> avec <strong>${escapeHtml(m.practitionerName)}</strong> est reporté au <strong>${escapeHtml(when(m))}</strong>.</p><p><a href="${escapeHtml(m.manageUrl)}">Annuler ou reporter</a></p><p>À bientôt,</p>`,
    ),
    ics,
  };
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
      from: env.EMAIL_FROM,
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
