import { randomBytes } from "node:crypto";

import type { DbOrTx } from "@/dal/types";
import * as invitesDal from "@/dal/invites";
import * as membersDal from "@/dal/members";
import * as officesDal from "@/dal/offices";
import * as practitionersDal from "@/dal/practitioners";
import * as usersDal from "@/dal/users";
import {
  createMailer,
  type SendEmail,
} from "@/lib/email";
import type {
  AcceptInviteInput,
  CreateInviteInput,
  CreateOfficeInput,
} from "@/lib/schemas/team";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";

/**
 * Service équipe : invitations + acceptation (SPEC.md §F2).
 * Seul un `owner` peut inviter. L'acceptation crée `member` + `practitioner`.
 *
 * Formes d'entrée depuis `@/lib/schemas/team` (source unique).
 */

export interface TeamDeps {
  /** Override de connexion (tests) ou transaction. Absent = connexion partagée du DAL. */
  tx?: DbOrTx;
  now?: Date;
  sendEmail?: SendEmail;
}

const INVITE_TTL_MS = 7 * 24 * 3_600_000;

/** Création d'un cabinet : office + membre owner + praticien pour le créateur. */
export async function createOffice(
  deps: TeamDeps,
  input: CreateOfficeInput,
): Promise<{ officeId: string; officeSlug: string; practitionerSlug: string }> {
  const slugTaken = await officesDal.getOfficeBySlug(input.slug, deps.tx);
  if (slugTaken) throw new ConflictError("Cet identifiant de cabinet est déjà pris");

  const base = slugify(input.userName);
  let practitionerSlug = base;
  for (let n = 2; ; n++) {
    const taken = await practitionersDal.getPractitionerBySlug(practitionerSlug, deps.tx);
    if (!taken) break;
    practitionerSlug = `${base}-${n}`;
  }

  const officeId = crypto.randomUUID();
  await officesDal.createOffice({
    office: {
      id: officeId,
      name: input.name,
      slug: input.slug,
      address: input.address ?? null,
    },
    member: { id: crypto.randomUUID(), officeId, userId: input.userId, role: "owner" },
    practitioner: {
      id: crypto.randomUUID(),
      officeId,
      userId: input.userId,
      displayName: input.userName,
      slug: practitionerSlug,
    },
  }, deps.tx);
  return { officeId, officeSlug: input.slug, practitionerSlug };
}

export function slugify(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "praticien";
  return base;
}

export async function createInvite(
  deps: TeamDeps,
  input: CreateInviteInput,
): Promise<{ id: string; token: string }> {
  const now = deps.now ?? new Date();
  const send = deps.sendEmail ?? createMailer();

  const requester = await membersDal.getMembership(input.officeId, input.requesterUserId, deps.tx);
  if (!requester || requester.role !== "owner" || !requester.active) {
    throw new ForbiddenError("Seul le responsable du cabinet peut inviter");
  }
  const email = input.email;
  const office = await officesDal.getOfficeById(input.officeId, deps.tx);
  if (!office) throw new NotFoundError("Cabinet introuvable");

  // Déjà membre avec cet email ? On refuse poliment.
  const existingUser = await usersDal.getUserByEmail(email, deps.tx);
  if (existingUser) {
    const existing = await membersDal.getMembership(input.officeId, existingUser.id, deps.tx);
    if (existing) throw new ConflictError("Cette personne est déjà membre du cabinet");
  }

  const token = randomBytes(32).toString("hex");
  const id = await invitesDal.createInvite({
    id: crypto.randomUUID(),
    officeId: input.officeId,
    email,
    role: input.role,
    token,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    invitedByUserId: input.requesterUserId,
  }, deps.tx);

  await send({
    to: email,
    subject: `Invitation à rejoindre ${office.name}`,
    text: `Bonjour,\n\n${office.name} vous invite à rejoindre son cabinet partagé en tant que ${input.role === "owner" ? "responsable" : "praticien"}.\n\nAcceptez l'invitation (valable 7 jours) : ${input.origin}/invite/${token}\n\nSi vous n'avez pas encore de compte, créez-en un avec cette adresse email puis acceptez l'invitation.`,
    html: `<div style="font-family:sans-serif;max-width:560px"><p>Bonjour,</p><p><strong>${office.name}</strong> vous invite à rejoindre son cabinet partagé.</p><p><a href="${input.origin}/invite/${token}">Accepter l'invitation</a> (valable 7 jours).</p><p>Si vous n'avez pas encore de compte, créez-en un avec cette adresse email puis acceptez l'invitation.</p></div>`,
  });
  return { id, token };
}

export async function acceptInvite(
  deps: TeamDeps,
  input: AcceptInviteInput,
): Promise<{ officeSlug: string; practitionerSlug: string }> {
  const now = deps.now ?? new Date();

  const inv = await invitesDal.getInviteByToken(input.token, deps.tx);
  if (!inv) throw new NotFoundError("Invitation introuvable");
  if (inv.acceptedAt) throw new ConflictError("Invitation déjà acceptée");
  if (inv.expiresAt.getTime() < now.getTime()) {
    throw new ValidationError("Invitation expirée");
  }
  if (inv.email.toLowerCase() !== input.userEmail.toLowerCase()) {
    throw new ValidationError("Cette invitation est adressée à une autre adresse email");
  }
  const office = await officesDal.getOfficeById(inv.officeId, deps.tx);
  if (!office) throw new NotFoundError("Cabinet introuvable");

  const already = await membersDal.getMembership(inv.officeId, input.userId, deps.tx);
  if (already) throw new ConflictError("Vous êtes déjà membre de ce cabinet");

  const base = slugify(input.userName);
  let slug = base;
  for (let n = 2; ; n++) {
    const taken = await practitionersDal.getPractitionerBySlug(slug, deps.tx);
    if (!taken) break;
    slug = `${base}-${n}`;
  }

  await invitesDal.acceptInvite({
    inviteId: inv.id,
    now,
    member: {
      id: crypto.randomUUID(),
      officeId: inv.officeId,
      userId: input.userId,
      role: inv.role,
    },
    practitioner: {
      id: crypto.randomUUID(),
      officeId: inv.officeId,
      userId: input.userId,
      displayName: input.userName,
      slug,
    },
  }, deps.tx);
  return { officeSlug: office.slug, practitionerSlug: slug };
}

/** Infos publiques d'une invitation (le token fait office de secret). Null si inconnue. */
export async function getInvitePublicInfo(deps: TeamDeps, token: string) {
  const now = deps.now ?? new Date();
  const inv = await invitesDal.getInviteByToken(token, deps.tx);
  if (!inv) return null;
  const office = await officesDal.getOfficeById(inv.officeId, deps.tx);
  return {
    officeName: office?.name ?? "",
    email: inv.email,
    expired: inv.expiresAt.getTime() < now.getTime(),
    accepted: inv.acceptedAt !== null,
  };
}

/** Invitations en attente d'un cabinet (owner uniquement). */
export async function listPendingInvites(
  deps: TeamDeps,
  input: { officeId: string; requesterUserId: string },
) {
  const requester = await membersDal.getMembership(input.officeId, input.requesterUserId, deps.tx);
  if (!requester || requester.role !== "owner" || !requester.active) {
    throw new ForbiddenError("Seul le responsable du cabinet peut voir les invitations");
  }
  const invites = await invitesDal.listPendingInvites(input.officeId, deps.tx);
  return {
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
    })),
  };
}
