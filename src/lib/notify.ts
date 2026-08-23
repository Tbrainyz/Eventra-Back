import mongoose from 'mongoose'
import logger from '../config/logger.js'
import Notification from '../models/notification.js'
import User from '../models/user.js'

export interface NotifyInput {
  type: string
  title: string
  message: string
  link?: string
}

/**
 * Fire-and-forget, same reasoning as logAdminAction — whatever triggered
 * this (an approval, a new sale, a report) has already succeeded by the
 * time this is called, so a failure here should never roll back or fail
 * the action that caused it.
 */
export async function notifyUser(recipientId: string | mongoose.Types.ObjectId, input: NotifyInput): Promise<void> {
  try {
    await Notification.create({ recipient: recipientId, ...input })
  } catch (error) {
    logger.error({ err: error }, `Failed to create notification "${input.type}" for user ${recipientId}`)
  }
}

/**
 * Fans out to every admin account — used for things any admin should see
 * (a new event/organizer/promotion/refund awaiting review, a new report or
 * dispute), not just the one who happens to act on it first.
 */
export async function notifyAdmins(input: NotifyInput): Promise<void> {
  try {
    const admins = await User.find({ role: 'admin' }).select('_id').lean()
    if (admins.length === 0) return
    await Notification.insertMany(admins.map(admin => ({ recipient: admin._id, ...input })))
  } catch (error) {
    logger.error({ err: error }, `Failed to fan out notification "${input.type}" to admins`)
  }
}
