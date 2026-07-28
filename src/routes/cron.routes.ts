import { Router } from 'express'
import { checkPayoutCron, checkPromotionExpiryCron } from '../controllers/cron.controller.js'

const router = Router()

/**
 * GET /api/cron-payouts — processes payouts due for events that finished a
 * few days ago. GET /api/cron-promotion-expiry — un-features expired promotions.
 * Both are Vercel Cron Job endpoints, protected by CRON_SECRET header check.
 */
router.get('/cron-payouts', checkPayoutCron)
router.get('/cron-promotion-expiry', checkPromotionExpiryCron)

export default router
