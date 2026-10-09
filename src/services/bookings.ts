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
  ManualBookingInput,
  RescheduleInput,
  RoomAvailabilityInput,
  SlotsInput,
  ValidateInput,
} from "@/lib/schemas/bookings";
import { createBooking } from "./bookings/create";
import { cancelApiBooking, createApiBooking, getApiCatalog, listApiBookings, type ApiBookingItem, type ApiCancelInput, type ApiCatalog, type ApiCreateInput, type ApiListFilter } from "./bookings/api";
import { createManualBooking, getManualFormData, getRoomAvailability, type ManualFormData, type RoomAvailability } from "./bookings/manual";
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
  bookingEventData,
  deadline,
  mailModel,
  manageUrl,
  notifyValidationRequest,
  safeSend,
  tariffSnapshot,
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
export { cancelApiBooking, createApiBooking, getApiCatalog, listApiBookings } from "./bookings/api";
export type { ApiBookingItem, ApiCancelInput, ApiCatalog, ApiCreateInput, ApiListFilter } from "./bookings/api";
export { createManualBooking, getManualFormData, getRoomAvailability } from "./bookings/manual";
export type { ManualFormData, RoomAvailability } from "./bookings/manual";
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
  createManual(input: ManualBookingInput): Promise<BookingResult>;
  roomAvailability(input: RoomAvailabilityInput): Promise<RoomAvailability>;
  manualFormData(requesterUserId: string): Promise<ManualFormData>;
  cancel(input: CancelInput): Promise<{ id: string; status: string }>;
  reschedule(input: RescheduleInput): Promise<BookingResult>;
  validate(input: ValidateInput): Promise<{ id: string; status: string }>;
  applyPayment(input: ApplyPaymentInput): Promise<{ applied: boolean; confirmed: boolean }>;
  statusByStripeSession(stripeSessionId: string): ReturnType<typeof getBookingStatusByStripeSession>;
  releaseExpired(): Promise<number>;
  availableSlots(input: SlotsInput): Promise<PublicSlot[]>;
  createApi(input: ApiCreateInput): Promise<BookingResult>;
  cancelApi(input: ApiCancelInput): Promise<{ id: string; status: string }>;
  listApi(practitionerId: string, filter: ApiListFilter): Promise<ApiBookingItem[]>;
  catalog(practitionerId: string): Promise<ApiCatalog>;
}

export function createBookingsService(ports: Ports): BookingsService {
  return {
    create: (input) => createBooking(ports, input),
    createManual: (input) => createManualBooking(ports, input),
    roomAvailability: (input) => getRoomAvailability(ports, input),
    manualFormData: (requesterUserId) => getManualFormData(requesterUserId),
    cancel: (input) => cancelBooking(ports, input),
    reschedule: (input) => rescheduleBooking(ports, input),
    validate: (input) => validateBooking(ports, input),
    applyPayment: (input) => applyPaymentCompleted(ports, input),
    statusByStripeSession: (stripeSessionId) => getBookingStatusByStripeSession(stripeSessionId),
    releaseExpired: () => releaseExpiredPendings(ports),
    availableSlots: (input) => getAvailableSlots(ports, input),
    createApi: (input) => createApiBooking(ports, input),
    cancelApi: (input) => cancelApiBooking(ports, input),
    listApi: (practitionerId, filter) => listApiBookings(practitionerId, filter),
    catalog: (practitionerId) => getApiCatalog(practitionerId),
  };
}
