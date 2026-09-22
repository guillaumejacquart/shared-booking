/**
 * Façade du service réservation : ré-exporte les sous-modules
 * (`slots`, `create`, `payment`, `manage`, `shared`) pour préserver le
 * chemin d'import historique `@/lib/services/bookings`.
 */
export type { Deps, StripeLike } from "./bookings/shared";
export {
  MAX_BUFFER_MIN,
  MAX_FUTURE_PER_EMAIL,
  PENDING_TTL_MS,
  bookingIcs,
  deadline,
  mailModel,
  manageUrl,
  notifyValidationRequest,
  realStripe,
  safeSend,
  tokens,
} from "./bookings/shared";
export {
  allowedRoomIdsFor,
  getAvailableSlots,
  getSlotsWithRoom,
  loadSlotContext,
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
