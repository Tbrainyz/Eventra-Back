import { Router } from 'express'
import { listPromotionPackages } from '../controllers/promotion.controller.js'

const router = Router()

router.get('/packages', listPromotionPackages)

export default router
