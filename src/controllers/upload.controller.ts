import { Request, Response } from 'express'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import { CloudinaryService } from '../services/cloudinary.service.js'

export const uploadEventCoverImage = tryCatchWrapper(async (req: Request, res: Response) => {
  if (!req.file) {
    return sendTsRestError(res, 400, 'No image file provided (expected field name "image")')
  }

  try {
    const uploaded = await CloudinaryService.uploadImage(req.file.buffer, 'event-covers')

    return sendTsRestSuccess(res, 201, {
      success: true,
      message: 'Image uploaded',
      body: uploaded,
    })
  } catch (error: any) {
    return sendTsRestError(res, 502, error.message || 'Image upload failed')
  }
})

// Reuses the same square/face-crop transform as user avatars (uploadAvatar,
// not the 16:9 uploadImage used for event covers) — lineup photos render as
// circular headshots on the event page, same as an avatar does.
export const uploadLineupPhoto = tryCatchWrapper(async (req: Request, res: Response) => {
  if (!req.file) {
    return sendTsRestError(res, 400, 'No image file provided (expected field name "image")')
  }

  try {
    const uploaded = await CloudinaryService.uploadAvatar(req.file.buffer, 'lineup-photos')

    return sendTsRestSuccess(res, 201, {
      success: true,
      message: 'Image uploaded',
      body: uploaded,
    })
  } catch (error: any) {
    return sendTsRestError(res, 502, error.message || 'Image upload failed')
  }
})

// Same 16:9-friendly transform as the cover image, not the avatar crop —
// gallery photos display as a grid of full images, not headshots.
export const uploadGalleryPhoto = tryCatchWrapper(async (req: Request, res: Response) => {
  if (!req.file) {
    return sendTsRestError(res, 400, 'No image file provided (expected field name "image")')
  }

  try {
    const uploaded = await CloudinaryService.uploadImage(req.file.buffer, 'event-gallery')

    return sendTsRestSuccess(res, 201, {
      success: true,
      message: 'Image uploaded',
      body: uploaded,
    })
  } catch (error: any) {
    return sendTsRestError(res, 502, error.message || 'Image upload failed')
  }
})
