import { Router } from 'express'
import { getOrganizerProfile, listOrganizerPayouts, upsertOrganizerProfile } from '../controllers/organizer.controller.js'
import { verifySession } from '../middlewares/auth.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import { organizerProfileSchema } from '../lib/schemaValidation.js'

const router = Router()

router.use(verifySession)

router.get('/profile', getOrganizerProfile)
router.patch('/profile', validateFormData(organizerProfileSchema), upsertOrganizerProfile)
router.get('/payouts', listOrganizerPayouts)

export default router
