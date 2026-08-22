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

const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png']
const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024 // 10MB — scans of physical documents run larger than a typical photo

/** Verification documents (CAC certificate, director ID, proof of address) — PDF or photo, unlike imageUpload above. */
export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
  fileFilter: (req, file, callback) => {
    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
      callback(new Error('Only PDF, JPEG, or PNG files are allowed'))
      return
    }
    callback(null, true)
  },
})
