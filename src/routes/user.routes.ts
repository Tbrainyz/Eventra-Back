import { Router } from 'express'
import {
  listOrderHistory,
  listSavedEvents,
  saveEvent,
  unsaveEvent,
  updateProfile,
  uploadAvatar,
} from '../controllers/user.controller.js'
import { verifySession } from '../middlewares/auth.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import { updateProfileSchema } from '../lib/schemaValidation.js'
import { imageUpload } from '../middlewares/upload.middleware.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'

const router = Router()

router.use(verifySession)

router.patch('/profile', validateFormData(updateProfileSchema), updateProfile)
router.post('/avatar', customRateLimiter(10), imageUpload.single('image'), uploadAvatar)
router.get('/orders', listOrderHistory)
router.get('/saved-events', listSavedEvents)
router.post('/saved-events/:eventId', saveEvent)
router.delete('/saved-events/:eventId', unsaveEvent)

export default router
