import { Router } from 'express'
import { uploadEventCoverImage } from '../controllers/upload.controller.js'
import { requireRole, verifySession } from '../middlewares/auth.middleware.js'
import { imageUpload } from '../middlewares/upload.middleware.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'

const router = Router()

router.post(
  '/event-cover',
  verifySession,
  requireRole('organizer'),
  customRateLimiter(10),
  imageUpload.single('image'),
  uploadEventCoverImage
)

export default router
