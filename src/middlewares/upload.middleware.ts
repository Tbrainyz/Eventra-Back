import multer from 'multer'

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 // 5MB

/**
 * Memory storage — the file buffer goes straight to Cloudinary, never touches
 * this server's disk (important on serverless/Vercel, where disk writes
 * don't persist anyway).
 */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      callback(new Error('Only JPEG, PNG, or WEBP images are allowed'))
      return
    }
    callback(null, true)
  },
})
