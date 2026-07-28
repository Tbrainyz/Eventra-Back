import { Router } from 'express'
import {
  listOrderHistory,
  listSavedEvents,
  saveEvent,
  unsaveEvent,
  updateProfile,
} from '../controllers/user.controller.js'
import { verifySession } from '../middlewares/auth.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import { updateProfileSchema } from '../lib/schemaValidation.js'

const router = Router()

router.use(verifySession)

router.patch('/profile', validateFormData(updateProfileSchema), updateProfile)
router.get('/orders', listOrderHistory)
router.get('/saved-events', listSavedEvents)
router.post('/saved-events/:eventId', saveEvent)
router.delete('/saved-events/:eventId', unsaveEvent)

export default router
