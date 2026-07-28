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
