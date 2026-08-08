import { Router } from 'express'
import {
  getOrganizerNotificationPreferences,
  getOrganizerOverview,
  getOrganizerProfile,
  listBanks,
  listOrganizerPayouts,
  resolveBankAccount,
  submitOrganizerProfileForReview,
  updateOrganizerNotificationPreferences,
  upsertOrganizerProfile,
} from '../controllers/organizer.controller.js'
import { verifySession } from '../middlewares/auth.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import { organizerNotificationPreferencesSchema, organizerProfileSchema, resolveBankAccountSchema } from '../lib/schemaValidation.js'

const router = Router()

router.use(verifySession)

router.get('/profile', getOrganizerProfile)
router.patch('/profile', validateFormData(organizerProfileSchema), upsertOrganizerProfile)
router.post('/profile/submit', submitOrganizerProfileForReview)
router.get('/banks', listBanks)
router.post('/resolve-account', validateFormData(resolveBankAccountSchema), resolveBankAccount)
router.get('/overview', getOrganizerOverview)
router.get('/payouts', listOrganizerPayouts)
router.get('/notification-preferences', getOrganizerNotificationPreferences)
router.patch(
  '/notification-preferences',
  validateFormData(organizerNotificationPreferencesSchema),
  updateOrganizerNotificationPreferences
)

export default router
