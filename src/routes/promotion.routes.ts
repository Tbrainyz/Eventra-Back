import { Router } from 'express'
import { listMyPromotions, listPromotionPackages } from '../controllers/promotion.controller.js'
import { verifySession, requireRole } from '../middlewares/auth.middleware.js'

const router = Router()

router.get('/packages', listPromotionPackages)
router.get('/mine', verifySession, requireRole('organizer'), listMyPromotions)

export default router
