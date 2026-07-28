import { Router } from 'express'
import { listPublicCategories } from '../controllers/category.controller.js'

const router = Router()

router.get('/', listPublicCategories)

export default router
