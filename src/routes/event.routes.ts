import { Router } from 'express'
import {
  cancelEvent,
  createEvent,
  deleteEvent,
  getEventBySlug,
  getEventDashboard,
  getMyEventById,
  listMyEvents,
  listPublicEvents,
  postponeEvent,
  submitEventForApproval,
  updateEvent,
  updateEventLineup,
} from '../controllers/event.controller.js'
import { checkInTicket, listEventAttendees } from '../controllers/ticket.controller.js'
import { requestPromotion } from '../controllers/promotion.controller.js'
import { requireRole, verifySession } from '../middlewares/auth.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import {
  checkInSchema,
  createEventSchema,
  postponeEventSchema,
  requestPromotionSchema,
  updateEventLineupSchema,
  updateEventSchema,
} from '../lib/schemaValidation.js'
import ticketTypeRoutes from './ticketType.routes.js'

const router = Router()

// Nested: /api/v1/events/:eventId/ticket-types
router.use('/:eventId/ticket-types', ticketTypeRoutes)

router.get('/', listPublicEvents)
router.get('/mine', verifySession, requireRole('organizer'), listMyEvents)
router.get('/mine/:id', verifySession, requireRole('organizer'), getMyEventById)

router.post('/', verifySession, requireRole('organizer'), validateFormData(createEventSchema), createEvent)
router.patch('/:id', verifySession, requireRole('organizer'), validateFormData(updateEventSchema), updateEvent)
router.patch('/:id/lineup', verifySession, requireRole('organizer'), validateFormData(updateEventLineupSchema), updateEventLineup)
router.post('/:id/submit', verifySession, requireRole('organizer'), submitEventForApproval)
router.delete('/:id', verifySession, requireRole('organizer'), deleteEvent)
router.get('/:id/dashboard', verifySession, requireRole('organizer'), getEventDashboard)
router.patch('/:id/cancel', verifySession, requireRole('organizer', 'admin'), cancelEvent)
router.patch('/:id/postpone', verifySession, requireRole('organizer', 'admin'), validateFormData(postponeEventSchema), postponeEvent)
router.post('/:eventId/check-in', verifySession, requireRole('organizer'), validateFormData(checkInSchema), checkInTicket)
router.get('/:eventId/attendees', verifySession, requireRole('organizer'), listEventAttendees)
router.post('/:id/promote', verifySession, requireRole('organizer'), validateFormData(requestPromotionSchema), requestPromotion)

// Keep this last — it's a catch-all single-segment GET.
router.get('/:slug', getEventBySlug)

export default router
