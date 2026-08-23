import { Router } from 'express'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../controllers/notification.controller.js'
import { verifySession } from '../middlewares/auth.middleware.js'

const router = Router()

router.use(verifySession)

router.get('/', listNotifications)
router.patch('/read-all', markAllNotificationsRead)
router.patch('/:id/read', markNotificationRead)

export default router
