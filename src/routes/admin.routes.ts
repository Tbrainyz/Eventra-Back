import { Router } from 'express'
import {
  approveEvent,
  approveEventPromotion,
  approveOrganizer,
  approveRefundRequest,
  flagEvent,
  getAdminOverview,
  getAdminPayoutsOverview,
  getAdminRevenue,
  getAttendeeDetailForAdmin,
  getEventDetailForAdmin,
  getOrganizerDetailForAdmin,
  getPlatformStats,
  getRefundRequestDetail,
  listAttendeesForAdmin,
  listAwaitingPayouts,
  listEventsForAdmin,
  listOrganizersForAdmin,
  listPayoutHistory,
  listPendingEvents,
  listPendingOrganizers,
  listRefundRequests,
  listUsers,
  rejectEvent,
  rejectEventPromotion,
  rejectOrganizer,
  rejectRefundRequest,
  releaseEventPayout,
  removeEvent,
  suspendUser,
  unflagEvent,
  unsuspendUser,
} from '../controllers/admin.controller.js'
import { createCategory, listAllCategories, updateCategory } from '../controllers/category.controller.js'
import { requireAdmin, verifySession } from '../middlewares/auth.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import { createCategorySchema, rejectEventSchema, updateCategorySchema } from '../lib/schemaValidation.js'

const router = Router()

router.use(verifySession, requireAdmin)

// Platform stats
router.get('/stats', getPlatformStats)
router.get('/overview', getAdminOverview)

// Generic user list (any role) — kept for internal/cross-role lookups.
// The Users management page uses /attendees below instead, since it needs
// per-attendee order/spend stats this endpoint doesn't compute.
router.get('/users', listUsers)
router.patch('/users/:id/suspend', suspendUser)
router.patch('/users/:id/unsuspend', unsuspendUser)

// Attendee management (Manage > Users)
router.get('/attendees', listAttendeesForAdmin)
router.get('/attendees/:id', getAttendeeDetailForAdmin)

// Organizer approval + management
router.get('/organizers/pending', listPendingOrganizers)
router.get('/organizers', listOrganizersForAdmin)
router.get('/organizers/:id', getOrganizerDetailForAdmin)
router.patch('/organizers/:id/approve', approveOrganizer)
router.patch('/organizers/:id/reject', rejectOrganizer)

// Event approval + management
router.get('/events/pending', listPendingEvents)
router.get('/events', listEventsForAdmin)
router.get('/events/:id', getEventDetailForAdmin)
router.patch('/events/:id/approve', approveEvent)
router.patch('/events/:id/reject', validateFormData(rejectEventSchema), rejectEvent)
router.patch('/events/:id/flag', flagEvent)
router.patch('/events/:id/unflag', unflagEvent)
router.patch('/events/:id/remove', removeEvent)

// Promotion approval
router.patch('/events/:id/promotion/approve', approveEventPromotion)
router.patch('/events/:id/promotion/reject', rejectEventPromotion)

// Refund requests
router.get('/refund-requests', listRefundRequests)
router.get('/refund-requests/:id', getRefundRequestDetail)
router.patch('/refund-requests/:id/approve', approveRefundRequest)
router.patch('/refund-requests/:id/reject', rejectRefundRequest)

// Revenue (Platform > Revenue)
router.get('/revenue', getAdminRevenue)

// Payouts (Platform > Payouts)
router.get('/payouts/overview', getAdminPayoutsOverview)
router.get('/payouts/awaiting', listAwaitingPayouts)
router.get('/payouts/history', listPayoutHistory)
router.post('/payouts/:organizerId/:eventId/release', releaseEventPayout)

// Categories
router.get('/categories', listAllCategories)
router.post('/categories', validateFormData(createCategorySchema), createCategory)
router.patch('/categories/:id', validateFormData(updateCategorySchema), updateCategory)

export default router
