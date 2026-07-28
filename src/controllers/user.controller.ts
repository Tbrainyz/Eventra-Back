import { Request, Response } from 'express'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import { sanitizeUser } from '../lib/utils.js'
import Order from '../models/order.js'
import User from '../models/user.js'

export const updateProfile = tryCatchWrapper(async (req: Request, res: Response) => {
  const { fullname, phone, currentPassword, newPassword } = req.body as {
    fullname?: string
    phone?: string
    currentPassword?: string
    newPassword?: string
  }

  const user = await User.findById(req.session.userId).select('+password')
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  if (fullname) user.fullname = fullname
  if (phone) user.phone = phone

  if (newPassword) {
    if (!currentPassword) {
      return sendTsRestError(res, 400, 'currentPassword is required to set a new password')
    }
    const matches = await user.matchPassword(currentPassword)
    if (!matches) {
      return sendTsRestError(res, 401, 'Current password is incorrect')
    }
    user.password = newPassword
  }

  await user.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Profile updated',
    body: sanitizeUser(user.toObject()),
  })
})

export const saveEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { eventId } = req.params
  await User.updateOne({ _id: req.session.userId }, { $addToSet: { savedEvents: eventId } })

  return sendTsRestSuccess<undefined>(res, 200, {
    success: true,
    message: 'Event saved',
  })
})

export const unsaveEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { eventId } = req.params
  await User.updateOne({ _id: req.session.userId }, { $pull: { savedEvents: eventId } })

  return sendTsRestSuccess<undefined>(res, 200, {
    success: true,
    message: 'Event removed from saved events',
  })
})

export const listSavedEvents = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId)
    .populate({
      path: 'savedEvents',
      match: { status: 'approved' },
      select: 'title slug startDate venue coverImage type',
    })
    .lean()

  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Saved events fetched',
    body: user.savedEvents,
  })
})

export const listOrderHistory = tryCatchWrapper(async (req: Request, res: Response) => {
  const orders = await Order.find({ buyer: req.session.userId })
    .populate('event', 'title slug startDate coverImage')
    .sort({ createdAt: -1 })
    .lean()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Order history fetched',
    body: orders,
  })
})
