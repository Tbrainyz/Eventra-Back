import { Request, Response } from 'express'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import { buildPaginationMeta, getPagination, sanitizeUser } from '../lib/utils.js'
import Event from '../models/event.js'
import Order from '../models/order.js'
import User from '../models/user.js'

/**
 * Create or update the caller's organizer profile (bank details, business name).
 * Promotes the account to the 'organizer' role if it isn't already one.
 * Submitting new bank details resets approval to 'pending' — an admin must
 * re-approve before the organizer can publish paid events, per the PRD.
 */
export const upsertOrganizerProfile = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId)
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  const existing = user.organizerProfile
  const bankDetailsChanged =
    !existing ||
    (req.body.accountNumber && req.body.accountNumber !== existing.accountNumber) ||
    (req.body.bankCode && req.body.bankCode !== existing.bankCode)

  user.role = 'organizer'
  user.organizerProfile = {
    businessName: req.body.businessName ?? existing?.businessName,
    bankName: req.body.bankName ?? existing?.bankName,
    bankCode: req.body.bankCode ?? existing?.bankCode,
    accountNumber: req.body.accountNumber ?? existing?.accountNumber,
    accountName: req.body.accountName ?? existing?.accountName,
    isPayoutReady: existing?.isPayoutReady ?? false,
    approvalStatus: bankDetailsChanged ? 'pending' : existing!.approvalStatus,
  }

  await user.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Organizer profile updated',
    body: sanitizeUser(user.toObject()),
  })
})

export const getOrganizerProfile = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId).lean()
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Organizer profile fetched',
    body: user.organizerProfile ?? null,
  })
})

export const listOrganizerPayouts = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)

  const eventIds = await Event.find({ organizer: req.session.userId }).distinct('_id')
  const filter = { event: { $in: eventIds }, status: { $in: ['paid', 'partially_refunded'] } }

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .select('event organizerEarnings payoutStatus payoutAt createdAt')
      .populate('event', 'title slug startDate')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
  ])

  const totals = await Order.aggregate([
    { $match: filter },
    { $group: { _id: '$payoutStatus', amount: { $sum: '$organizerEarnings' } } },
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Payouts fetched',
    body: {
      orders,
      meta: buildPaginationMeta(page, limit, total),
      totalsByStatus: totals.reduce((acc, t) => ({ ...acc, [t._id]: t.amount }), {} as Record<string, number>),
    },
  })
})
