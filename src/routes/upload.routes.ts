import { Router } from 'express'
import { uploadEventCoverImage, uploadGalleryPhoto, uploadLineupPhoto, uploadOrganizerDocument } from '../controllers/upload.controller.js'
import { requireRole, verifySession } from '../middlewares/auth.middleware.js'
import { documentUpload, imageUpload } from '../middlewares/upload.middleware.js'
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

router.post(
  '/lineup-photo',
  verifySession,
  requireRole('organizer'),
  customRateLimiter(10),
  imageUpload.single('image'),
  uploadLineupPhoto
)

router.post(
  '/gallery-photo',
  verifySession,
  requireRole('organizer'),
  customRateLimiter(10),
  imageUpload.single('image'),
  uploadGalleryPhoto
)

router.post(
  '/organizer-document',
  verifySession,
  requireRole('organizer'),
  customRateLimiter(10),
  documentUpload.single('document'),
  uploadOrganizerDocument
)

export default router
