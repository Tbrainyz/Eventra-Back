import { Router } from 'express'
import { paystackWebhook } from '../controllers/payment.controller.js'

const router = Router()

// Called by Paystack, not the client — no session auth here, signature is the guard.
router.post('/webhook', paystackWebhook)

export default router
