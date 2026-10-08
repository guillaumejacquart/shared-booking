import { describe, expect, it } from "vitest";

import { confirmationEmail, reminderEmail, type BookingMailPayload } from "./email";
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
