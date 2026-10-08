/**
 * Façade du service réservation : ré-exporte les sous-modules
 * (`slots`, `create`, `payment`, `manage`, `shared`) et expose la fabrique
 * de services injectés utilisée par `@/lib/container`.
 */
import type { Ports } from "@/lib/ports";
import type {
  ApplyPaymentInput,
  BookingResult,
  CancelInput,
  CreateBookingInput,
  RescheduleInput,
  SlotsInput,
  ValidateInput,
} from "@/lib/schemas/bookings";
import { createBooking } from "./bookings/create";
import {
  applyPaymentCompleted,
  getBookingStatusByStripeSession,
  releaseExpiredPendings,
} from "./bookings/payment";
import { cancelBooking, rescheduleBooking, validateBooking } from "./bookings/manage";
import { getAvailableSlots, type PublicSlot } from "./bookings/slots";

export type { MailBooking } from "./bookings/shared";
export type { Ports, StripeLike } from "@/lib/ports";
export {
  MAX_BUFFER_MIN,
  MAX_FUTURE_PER_EMAIL,
  PENDING_TTL_MS,
  deadline,
  mailModel,
  manageUrl,
  notifyValidationRequest,
  safeSend,
  tokens,
} from "./bookings/shared";
export {
  allowedRoomIdsFor,
  getAvailableSlots,
  getSlotsWithRoom,
  loadSlotContext,
  resolveVariant,
  slotOnGrid,
  toExceptions,
  toOccupancy,
  toWindows,
  type PublicSlot,
} from "./bookings/slots";
export { createBooking } from "./bookings/create";
export {
  applyPaymentCompleted,
  finalizeBookingIfReady,
  getBookingStatusByStripeSession,
  releaseExpiredPendings,
} from "./bookings/payment";
export { cancelBooking, rescheduleBooking, validateBooking } from "./bookings/manage";

/** Surface du service réservation (utilisée par les routes via le container). */
export interface BookingsService {
  create(input: CreateBookingInput): Promise<BookingResult>;
  cancel(input: CancelInput): Promise<{ id: string; status: string }>;
  reschedule(input: RescheduleInput): Promise<BookingResult>;
  validate(input: ValidateInput): Promise<{ id: string; status: string }>;
  applyPayment(input: ApplyPaymentInput): Promise<{ applied: boolean; confirmed: boolean }>;
  statusByStripeSession(stripeSessionId: string): ReturnType<typeof getBookingStatusByStripeSession>;
  releaseExpired(): Promise<number>;
  availableSlots(input: SlotsInput): Promise<PublicSlot[]>;
}

export function createBookingsService(ports: Ports): BookingsService {
  return {
    create: (input) => createBooking(ports, input),
    cancel: (input) => cancelBooking(ports, input),
    reschedule: (input) => rescheduleBooking(ports, input),
    validate: (input) => validateBooking(ports, input),
    applyPayment: (input) => applyPaymentCompleted(ports, input),
    statusByStripeSession: (stripeSessionId) => getBookingStatusByStripeSession(stripeSessionId),
    releaseExpired: () => releaseExpiredPendings(ports),
    availableSlots: (input) => getAvailableSlots(ports, input),
  };
}
