import { describe, expect, it } from "vitest";

import {
  confirmationEmail,
  mailFrom,
  paymentReceivedEmail,
  practitionerCancelledEmail,
  reminderEmail,
  rescheduledEmail,
  validationPendingEmail,
  type BookingMailPayload,
} from "./email";
import { passwordResetEmail } from "./email";

const MODEL: BookingMailPayload = {
  practitionerName: "Alice",
  sessionName: "Séance",
  start: new Date("2026-09-14T08:15:00.000Z"),
  timeZone: "Europe/Paris",
  officeName: "Cabinet",
  officeAddress: null,
  manageUrl: "https://example.com/gerer?token=x",
  ics: { filename: "rendez-vous.ics", content: "BEGIN:VCALENDAR" },
  googleUrl: "https://calendar.google.com/x",
};

describe("onsitePayment", () => {
  it("confirmation : prix + moyens + précision en texte et HTML", () => {
    const email = confirmationEmail("j@example.com", {
      ...MODEL,
      onsitePayment: { price: "60 €", methods: "espèces et carte bancaire", note: "Appoint apprécié" },
    });
    expect(email.text).toContain("Règlement sur place : 60 € (espèces et carte bancaire).");
    expect(email.text).toContain("Précision : Appoint apprécié");
    expect(email.html).toContain("Règlement sur place : <strong>60 €</strong> (espèces et carte bancaire).");
    expect(email.html).toContain("Précision : Appoint apprécié");
  });

  it("sans moyens ni note : prix seul, sans parenthèses", () => {
    const email = reminderEmail("j@example.com", {
      ...MODEL,
      onsitePayment: { price: "sur devis", methods: null, note: null },
    });
    expect(email.text).toContain("Règlement sur place : sur devis.");
    expect(email.text).not.toContain("Précision");
  });

  it("absent : aucune mention (gratuit, à définir, payé en ligne)", () => {
    const email = confirmationEmail("j@example.com", MODEL);
    expect(email.text).not.toContain("Règlement sur place");
    expect(email.html).not.toContain("Règlement sur place");
  });

  it("échappe la note libre en HTML", () => {
    const email = confirmationEmail("j@example.com", {
      ...MODEL,
      onsitePayment: { price: "60 €", methods: null, note: "<script>x</script>" },
    });
    expect(email.html).toContain("Précision : &lt;script&gt;x&lt;/script&gt;");
    expect(email.html).not.toContain("<script>x</script>");
  });
});

describe("accessInfo + practitionerMessage", () => {
  const FULL: BookingMailPayload = {
    ...MODEL,
    officeAddress: "1 rue des Tilleuls",
    officeAccessInfo: "Digicode 12A34\n2e étage porte gauche",
    practitionerMessage: "Pensez à apporter une serviette.",
  };

  it("confirmation : lieu + accès + message en texte et HTML", () => {
    const email = confirmationEmail("j@example.com", FULL);
    expect(email.text).toContain("Lieu : Cabinet, 1 rue des Tilleuls.");
    expect(email.text).toContain("Accès : Digicode 12A34");
    expect(email.text).toContain("Message du praticien :\nPensez à apporter une serviette.");
    expect(email.html).toContain("Accès : Digicode 12A34<br />2e étage porte gauche");
    expect(email.html).toContain("Message du praticien :<br />Pensez à apporter une serviette.");
  });

  it("rappel : lieu + accès + message", () => {
    const email = reminderEmail("j@example.com", FULL);
    expect(email.text).toContain("Lieu : Cabinet, 1 rue des Tilleuls.");
    expect(email.text).toContain("Accès : Digicode 12A34");
    expect(email.text).toContain("Pensez à apporter une serviette.");
    expect(email.html).toContain("Accès : Digicode 12A34");
  });

  it("report : accès + message", () => {
    const email = rescheduledEmail("j@example.com", FULL);
    expect(email.text).toContain("Accès : Digicode 12A34");
    expect(email.text).toContain("Pensez à apporter une serviette.");
    expect(email.html).toContain("Message du praticien :");
  });

  it("demande reçue / paiement reçu / annulation : message sans accès", () => {
    for (const email of [
      validationPendingEmail("j@example.com", FULL),
      paymentReceivedEmail("j@example.com", FULL),
      practitionerCancelledEmail("j@example.com", { ...FULL, reason: "Congés" }),
    ]) {
      expect(email.text).toContain("Pensez à apporter une serviette.");
      expect(email.text).not.toContain("Accès :");
      expect(email.html).toContain("Message du praticien :");
      expect(email.html).not.toContain("Accès :");
    }
  });

  it("absents : aucun bloc accès ni message", () => {
    for (const email of [
      confirmationEmail("j@example.com", MODEL),
      reminderEmail("j@example.com", MODEL),
      rescheduledEmail("j@example.com", MODEL),
    ]) {
      expect(email.text).not.toContain("Accès :");
      expect(email.text).not.toContain("Message du praticien");
      expect(email.html).not.toContain("Accès :");
      expect(email.html).not.toContain("Message du praticien");
    }
  });

  it("échappe le message libre en HTML", () => {
    const email = confirmationEmail("j@example.com", {
      ...MODEL,
      practitionerMessage: "<b>gras</b>",
    });
    expect(email.html).toContain("&lt;b&gt;gras&lt;/b&gt;");
    expect(email.html).not.toContain("<b>gras</b>");
    // …mais le texte brut reste lisible tel quel.
    expect(email.text).toContain("<b>gras</b>");
  });
});

describe("mailFrom", () => {
  it("expéditeur avec nom convivial (Gmail n'affiche plus `contact`)", () => {
    const from = mailFrom();
    expect(from.name).toBe("Le Cabinet Partagé");
    expect(typeof from.address).toBe("string");
    expect(from.address).toContain("@");
  });
});

describe("passwordResetEmail", () => {
  it("contient le lien de réinitialisation en texte et HTML", () => {
    const url = "http://localhost:3000/reset-password?token=abc123";
    const email = passwordResetEmail("user@example.com", url);
    expect(email.to).toBe("user@example.com");
    expect(email.subject).toContain("mot de passe");
    expect(email.text).toContain(url);
    expect(email.html).toContain(url);
    expect(email.html).toContain("<a href=");
    expect(email.ics).toBeUndefined();
  });
});
