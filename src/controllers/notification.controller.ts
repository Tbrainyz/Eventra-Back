import { Request, Response } from 'express'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import { buildPaginationMeta, getPagination } from '../lib/utils.js'
import Notification from '../models/notification.js'

// Available to any authenticated role — attendee, organizer, or admin —
// since every notification here is already scoped to `recipient ===
// req.session.userId`. No role check needed beyond being logged in.

export const listNotifications = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)
  const recipient = req.session.userId

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find({ recipient }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments({ recipient }),
    Notification.countDocuments({ recipient, read: false }),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Notifications fetched',
    body: { notifications, unreadCount, meta: buildPaginationMeta(page, limit, total) },
  })
})

export const markNotificationRead = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params

  const notification = await Notification.findOneAndUpdate({ _id: id, recipient: req.session.userId }, { read: true }, { new: true })
  if (!notification) {
    return sendTsRestError(res, 404, 'Notification not found')
  }

  return sendTsRestSuccess(res, 200, { success: true, message: 'Marked as read', body: notification.toObject() })
})

export const markAllNotificationsRead = tryCatchWrapper(async (req: Request, res: Response) => {
  await Notification.updateMany({ recipient: req.session.userId, read: false }, { read: true })

  return sendTsRestSuccess<undefined>(res, 200, { success: true, message: 'All notifications marked as read' })
})
