import { Router } from 'express'
import { checkDailySalesSummaryCron, checkPayoutCron, checkPromotionExpiryCron } from '../controllers/cron.controller.js'

const router = Router()

/**
 * GET /api/cron-payouts — processes payouts due for events that finished a
 * few days ago. GET /api/cron-promotion-expiry — un-features expired
 * promotions. GET /api/cron-daily-sales-summary — emails each opted-in
 * organizer their last-24h sales digest.
 * All three are Vercel Cron Job endpoints, protected by CRON_SECRET header check.
 */
router.get('/cron-payouts', checkPayoutCron)
router.get('/cron-promotion-expiry', checkPromotionExpiryCron)
router.get('/cron-daily-sales-summary', checkDailySalesSummaryCron)

export default router
