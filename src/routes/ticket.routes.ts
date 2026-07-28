import { Router } from 'express'
import {
  cancelReservation,
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

router.get('/:ticketId/qrcode', verifySession, getTicketQrCode)

router.delete('/:ticketId/reservation', verifySession, cancelReservation)

router.post('/:ticketId/refund-request', verifySession, validateFormData(refundRequestSchema), requestRefund)

export default router
