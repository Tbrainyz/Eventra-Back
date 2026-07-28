import { Router } from 'express'
import { forgotPassword, login, logout, me, register, resendOtp, resetPassword, verifyEmail } from '../controllers/auth.controller.js'
import { verifySession } from '../middlewares/auth.middleware.js'
import { customRateLimiter, strictLimiter } from '../middlewares/rateLimit.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import { forgotPasswordSchema, loginSchema, registerSchema, resendOtpSchema, resetPasswordSchema, verifyEmailSchema } from '../lib/schemaValidation.js'

const router = Router()

router.post('/register', customRateLimiter(5), validateFormData(registerSchema), register)

router.post('/verify-email', customRateLimiter(10), validateFormData(verifyEmailSchema), verifyEmail)

router.post('/resend-otp', strictLimiter, validateFormData(resendOtpSchema), resendOtp)

router.post('/login', strictLimiter, validateFormData(loginSchema), login)

router.post('/forgot-password', strictLimiter, validateFormData(forgotPasswordSchema), forgotPassword)

router.post('/reset-password', strictLimiter, validateFormData(resetPasswordSchema), resetPassword)

router.post('/logout', verifySession, logout)

router.get('/me', verifySession, me)

export default router
