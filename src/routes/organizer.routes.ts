import { Router } from 'express'
import {
  getOrganizerProfile,
  listBanks,
  listOrganizerPayouts,
  resolveBankAccount,
  submitOrganizerProfileForReview,
  upsertOrganizerProfile,
} from '../controllers/organizer.controller.js'
import { verifySession } from '../middlewares/auth.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import { organizerProfileSchema, resolveBankAccountSchema } from '../lib/schemaValidation.js'

const router = Router()

router.use(verifySession)

router.get('/profile', getOrganizerProfile)
router.patch('/profile', validateFormData(organizerProfileSchema), upsertOrganizerProfile)
router.post('/profile/submit', submitOrganizerProfileForReview)
router.get('/banks', listBanks)
router.post('/resolve-account', validateFormData(resolveBankAccountSchema), resolveBankAccount)
router.get('/payouts', listOrganizerPayouts)

export default router
