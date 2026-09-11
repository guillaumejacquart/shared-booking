import { describe, expect, it } from "vitest";

import { passwordResetEmail } from "./email";

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
