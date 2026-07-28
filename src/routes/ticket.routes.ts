import { Router } from 'express'
import {
  cancelReservation,
  getOrderByReference,
  getTicketQrCode,
  initializeCheckout,
  myTickets,
  requestRefund,
  rsvpFreeEvent,
} from '../controllers/ticket.controller.js'
import { verifySession } from '../middlewares/auth.middleware.js'
import { checkoutSchema, refundRequestSchema } from '../lib/schemaValidation.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'

const router = Router()

router.post('/rsvp/:eventId', verifySession, customRateLimiter(10), rsvpFreeEvent)

router.post('/checkout/:eventId', verifySession, customRateLimiter(10), validateFormData(checkoutSchema), initializeCheckout)

router.get('/my-tickets', verifySession, myTickets)

// Polled by /checkout/callback on the client after the Paystack redirect —
// keep this above '/:ticketId/qrcode' so 'orders' isn't swallowed as a ticketId.
router.get('/orders/:reference', verifySession, getOrderByReference)

router.get('/:ticketId/qrcode', verifySession, getTicketQrCode)

router.delete('/:ticketId/reservation', verifySession, cancelReservation)

router.post('/:ticketId/refund-request', verifySession, validateFormData(refundRequestSchema), requestRefund)

export default router
