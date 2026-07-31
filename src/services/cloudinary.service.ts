import { v2 as cloudinary } from 'cloudinary'
import { env } from '../config/keys.js'
import logger from '../config/logger.js'

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
})

export interface UploadedImage {
  url: string
  publicId: string
}

/**
 * Uploads an image buffer (from multer's memory storage) to Cloudinary.
 * Nothing else in the app should talk to Cloudinary directly — same pattern
 * as paystack.service.ts for the payment provider.
 */
export class CloudinaryService {
  static uploadImage(buffer: Buffer, folder: string): Promise<UploadedImage> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `eventra/${folder}`,
          resource_type: 'image',
          // Keeps stored images from becoming a runaway cost/storage surface —
          // large uploads are resized down, never upscaled.
          transformation: [{ width: 1600, height: 900, crop: 'limit' }],
        },
        (error, result) => {
          if (error || !result) {
            logger.error({ err: error }, 'Cloudinary upload failed')
            return reject(new Error(error?.message || 'Image upload failed'))
          }
          resolve({ url: result.secure_url, publicId: result.public_id })
        }
      )
      stream.end(buffer)
    })
  }

  /** Square, face-centered crop — separate from uploadImage's 16:9 limit-crop, which is wrong for a circular avatar/headshot. `folder` lets callers keep avatars and lineup photos in separate Cloudinary folders while sharing this transform. */
  static uploadAvatar(buffer: Buffer, folder: 'avatars' | 'lineup-photos' = 'avatars'): Promise<UploadedImage> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `eventra/${folder}`,
          resource_type: 'image',
          transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
        },
        (error, result) => {
          if (error || !result) {
            logger.error({ err: error }, 'Cloudinary avatar upload failed')
            return reject(new Error(error?.message || 'Image upload failed'))
          }
          resolve({ url: result.secure_url, publicId: result.public_id })
        }
      )
      stream.end(buffer)
    })
  }

  static async deleteImage(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId)
    } catch (error) {
      // Never let a failed cleanup block whatever the caller was actually doing.
      logger.error({ err: error }, `Cloudinary delete failed for ${publicId}`)
    }
  }
}

export const cloudinaryService = new CloudinaryService()
