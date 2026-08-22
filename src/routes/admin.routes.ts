import { Router } from 'express'
import {
  approveEvent,
  approveEventPromotion,
  approveOrganizer,
  approveRefundRequest,
  acceptDisputeLoss,
  challengeDispute,
  dismissEventFlag,
  dismissOrganizerFlag,
  flagEvent,
  getAdminOverview,
  getAdminPayoutsOverview,
  getAdminRevenue,
  getAttendeeDetailForAdmin,
  getDisputeDetail,
  getEventDetailForAdmin,
  getEventFlagDetail,
  getOrganizerDetailForAdmin,
  getOrganizerFlagDetail,
  getPlatformStats,
  getRefundRequestDetail,
  getSettings,
  inviteAdmin,
  listAttendeesForAdmin,
  listAuditLog,
  listAwaitingPayouts,
  listDisputes,
  listEventsForAdmin,
  listFlags,
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
  updateAdminRole,
  updateSettings,
} from '../controllers/admin.controller.js'
import { createCategory, listAllCategories, updateCategory } from '../controllers/category.controller.js'
import { requireAdmin, verifySession } from '../middlewares/auth.middleware.js'
import { requireAdminTier } from '../middlewares/adminPermission.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import { challengeDisputeSchema, createCategorySchema, inviteAdminSchema, rejectEventSchema, updateCategorySchema } from '../lib/schemaValidation.js'

const router = Router()

router.use(verifySession, requireAdmin)

// Platform stats
router.get('/stats', getPlatformStats)
router.get('/overview', getAdminOverview)

// Generic user list (any role) — kept for internal/cross-role lookups.
// The Users management page uses /attendees below instead, since it needs
// per-attendee order/spend stats this endpoint doesn't compute.
router.get('/users', listUsers)
router.patch('/users/:id/suspend', requireAdminTier('owner', 'admin'), suspendUser)
router.patch('/users/:id/unsuspend', requireAdminTier('owner', 'admin'), unsuspendUser)

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
router.patch('/events/:id/remove', requireAdminTier('owner', 'admin'), removeEvent)

// Promotion approval
router.patch('/events/:id/promotion/approve', approveEventPromotion)
router.patch('/events/:id/promotion/reject', rejectEventPromotion)

// Refund requests
router.get('/refund-requests', listRefundRequests)
router.get('/refund-requests/:id', getRefundRequestDetail)
router.patch('/refund-requests/:id/approve', approveRefundRequest)
router.patch('/refund-requests/:id/reject', rejectRefundRequest)

// Disputes (Refunds & dispute > Disputes) — same admin/owner-only tier as
// releasing a payout or removing an event, since accepting a loss moves
// real money out.
router.get('/disputes', listDisputes)
router.get('/disputes/:id', getDisputeDetail)
router.post('/disputes/:id/challenge', requireAdminTier('owner', 'admin'), validateFormData(challengeDisputeSchema), challengeDispute)
router.post('/disputes/:id/accept-loss', requireAdminTier('owner', 'admin'), acceptDisputeLoss)

// Revenue (Platform > Revenue)
router.get('/revenue', getAdminRevenue)

// Payouts (Platform > Payouts) — releasing money early is the single
// highest-stakes action in the whole console, so it's admin/owner only,
// same tier as suspending an account or removing an event outright.
router.get('/payouts/overview', getAdminPayoutsOverview)
router.get('/payouts/awaiting', listAwaitingPayouts)
router.get('/payouts/history', listPayoutHistory)
router.post('/payouts/:organizerId/:eventId/release', requireAdminTier('owner', 'admin'), releaseEventPayout)

// Reports (Needs action > Reports)
router.get('/reports/flags', listFlags)
router.get('/reports/flags/events/:id', getEventFlagDetail)
router.get('/reports/flags/organizers/:id', getOrganizerFlagDetail)
router.patch('/reports/flags/events/:id/dismiss', dismissEventFlag)
router.patch('/reports/flags/organizers/:id/dismiss', dismissOrganizerFlag)
router.get('/reports/audit-log', listAuditLog)

// Categories
router.get('/categories', listAllCategories)
router.post('/categories', validateFormData(createCategorySchema), createCategory)
router.patch('/categories/:id', validateFormData(updateCategorySchema), updateCategory)

// Settings (Platform > Settings) — owner-only. See adminPermission.middleware.ts's
// doc comment for why these three specifically are carved out from the
// regular admin/support tiers.
router.get('/settings', getSettings)
router.patch('/settings', requireAdminTier('owner'), updateSettings)
router.patch('/settings/admins/:id/role', requireAdminTier('owner'), updateAdminRole)
router.post('/settings/admins/invite', requireAdminTier('owner'), validateFormData(inviteAdminSchema), inviteAdmin)

export default router
