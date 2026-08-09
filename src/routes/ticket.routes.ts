import { Router } from 'express'
import {
  cancelReservation,
  getOrderByReference,
  getTicketQrCode,
  getTicketQrCodeImage,
  initializeCheckout,
  listGuestTickets,
  myTickets,
  requestGuestTicketAccess,
  requestRefund,
  rsvpFreeEvent,
  verifyGuestTicketAccess,
} from '../controllers/ticket.controller.js'
import { verifySession } from '../middlewares/auth.middleware.js'
import {
  checkoutSchema,
  guestTicketAccessRequestSchema,
  guestTicketAccessVerifySchema,
  refundRequestSchema,
  rsvpSchema,
} from '../lib/schemaValidation.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'

const router = Router()

// No verifySession on these — both work for a logged-in user (session)
// or a guest (guestName/guestEmail/guestPhone in the body). See
// resolveAttendeeInfo in lib/attendee.ts for how that's decided.
router.post('/rsvp/:eventId', customRateLimiter(10), validateFormData(rsvpSchema), rsvpFreeEvent)
router.post('/checkout/:eventId', customRateLimiter(10), validateFormData(checkoutSchema), initializeCheckout)

router.get('/my-tickets', verifySession, myTickets)

// "Track my ticket by email" — for a guest who wants to view/manage a
// ticket later, whether or not the confirmation email actually arrived.
router.post('/guest-access/request', customRateLimiter(5), validateFormData(guestTicketAccessRequestSchema), requestGuestTicketAccess)
router.post('/guest-access/verify', customRateLimiter(10), validateFormData(guestTicketAccessVerifySchema), verifyGuestTicketAccess)
router.get('/guest-access/tickets', listGuestTickets) // controller itself checks req.session.guestEmail

// Polled by /checkout/callback on the client after the Paystack redirect —
// keep this above '/:ticketId/qrcode' so 'orders' isn't swallowed as a ticketId.
// No verifySession: the reference is itself an unguessable capability (see
// getOrderByReference), same trust model as a payment receipt link.
router.get('/orders/:reference', getOrderByReference)

// Fully public, no session check — this is what the confirmation email's
// <img src> hits (see getTicketQrCodeImage's own comment for why it can't
// share getTicketQrCode below). Keep above '/:ticketId/qrcode' for the
// same reason /orders/:reference sits above it — a literal path segment
// should never be swallowed by a param route.
router.get('/qrcode-image/:code', getTicketQrCodeImage)

// No verifySession on these three — ownership is checked inside each
// controller via ticketBelongsToRequester, which accepts either a logged-in
// session or a verified guestEmail session. An anonymous request with
// neither just gets a 404, same as trying to access someone else's ticket.
router.get('/:ticketId/qrcode', getTicketQrCode)
router.delete('/:ticketId/reservation', cancelReservation)
router.post('/:ticketId/refund-request', validateFormData(refundRequestSchema), requestRefund)

export default router
