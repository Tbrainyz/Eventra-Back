import { Request, Response } from 'express'
import { getPromotionPackage } from '../config/promotionPackages.js'
import logger from '../config/logger.js'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import { buildPaginationMeta, escapeRegExp, getPagination, sanitizeUser } from '../lib/utils.js'
import { invalidateUserSessions } from '../lib/sessionStore.js'
import Event from '../models/event.js'
import Order from '../models/order.js'
import RefundRequest from '../models/refundRequest.js'
import Ticket from '../models/ticket.js'
import User from '../models/user.js'
import { EmailService } from '../services/email.service.js'
import { PaystackService } from '../services/paystack.service.js'

export const listUsers = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)

  const filter: Record<string, any> = {}
  if (req.query.role === 'attendee' || req.query.role === 'organizer' || req.query.role === 'admin') {
    filter.role = req.query.role
  }
  if (req.query.q && typeof req.query.q === 'string') {
    const term = new RegExp(escapeRegExp(req.query.q), 'i')
    filter.$or = [{ fullname: term }, { email: term }]
  }

  const [users, total] = await Promise.all([
    User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Users fetched',
    body: { users, meta: buildPaginationMeta(page, limit, total) },
  })
})

export const suspendUser = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const user = await User.findById(id)
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }
  if (user.role === 'admin') {
    return sendTsRestError(res, 400, "Admin accounts can't be suspended")
  }

  user.isSuspended = true
  await user.save()

  // Kick them out immediately rather than waiting for their session to expire naturally.
  await invalidateUserSessions(user._id.toString())

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'User suspended',
    body: sanitizeUser(user.toObject()),
  })
})

export const unsuspendUser = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const user = await User.findById(id)
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  user.isSuspended = false
  await user.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'User unsuspended',
    body: sanitizeUser(user.toObject()),
  })
})

export const getPlatformStats = tryCatchWrapper(async (req: Request, res: Response) => {
  const [salesAgg, promotedEvents, activeEvents, totalUsers, totalOrganizers, pendingRefunds] = await Promise.all([
    Order.aggregate([
      { $match: { status: { $in: ['paid', 'partially_refunded'] } } },
      { $group: { _id: null, grossSales: { $sum: '$subtotal' }, commissionRevenue: { $sum: '$platformFee' } } },
    ]),
    Event.find({ 'promotion.status': 'approved' }).select('promotion.package').lean(),
    Event.countDocuments({ status: { $in: ['approved', 'postponed'] } }),
    User.countDocuments({ role: 'attendee' }),
    User.countDocuments({ role: 'organizer' }),
    RefundRequest.countDocuments({ status: 'pending' }),
  ])

  const promotionRevenue = promotedEvents.reduce((sum, event) => {
    const pkg = getPromotionPackage(event.promotion?.package)
    return sum + (pkg?.priceNaira ?? 0)
  }, 0)

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Platform stats fetched',
    body: {
      grossTicketSales: salesAgg[0]?.grossSales ?? 0,
      commissionRevenue: salesAgg[0]?.commissionRevenue ?? 0,
      promotionRevenue,
      activeEvents,
      totalAttendees: totalUsers,
      totalOrganizers,
      pendingRefundRequests: pendingRefunds,
    },
  })
})

export const listPendingOrganizers = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)
  const filter = { role: 'organizer', 'organizerProfile.approvalStatus': 'pending' }

  const [organizers, total] = await Promise.all([
    User.find(filter).select('-password').sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Pending organizers fetched',
    body: { organizers, meta: buildPaginationMeta(page, limit, total) },
  })
})

export const approveOrganizer = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const organizer = await User.findOne({ _id: id, role: 'organizer' })
  if (!organizer || !organizer.organizerProfile) {
    return sendTsRestError(res, 404, 'Organizer not found')
  }

  const { accountName, accountNumber, bankCode } = organizer.organizerProfile
  if (!accountName || !accountNumber || !bankCode) {
    return sendTsRestError(res, 400, 'This organizer has not completed their bank details yet')
  }

  try {
    const recipient = await PaystackService.createTransferRecipient({
      name: accountName,
      accountNumber,
      bankCode,
    })
    organizer.organizerProfile.paystackRecipientCode = recipient.recipientCode
    organizer.organizerProfile.isPayoutReady = true
  } catch (error: any) {
    return sendTsRestError(res, 502, `Could not verify bank details with Paystack: ${error.message}`)
  }

  organizer.organizerProfile.approvalStatus = 'approved'
  await organizer.save()

  EmailService.sendOrganizerApprovedEmail(organizer).catch(error =>
    logger.error({ err: error }, `Organizer-approved email failed for ${organizer._id}`)
  )

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Organizer approved',
    body: sanitizeUser(organizer.toObject()),
  })
})

export const rejectOrganizer = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const organizer = await User.findOne({ _id: id, role: 'organizer' })
  if (!organizer || !organizer.organizerProfile) {
    return sendTsRestError(res, 404, 'Organizer not found')
  }

  organizer.organizerProfile.approvalStatus = 'rejected'
  await organizer.save()

  EmailService.sendOrganizerRejectedEmail(organizer).catch(error =>
    logger.error({ err: error }, `Organizer-rejected email failed for ${organizer._id}`)
  )

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Organizer rejected',
    body: sanitizeUser(organizer.toObject()),
  })
})

export const listPendingEvents = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)
  const filter = { status: 'pending_approval' }

  const [events, total] = await Promise.all([
    Event.find(filter)
      .populate('organizer', 'fullname email organizerProfile.businessName')
      .populate('category', 'name')
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Event.countDocuments(filter),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Pending events fetched',
    body: { events, meta: buildPaginationMeta(page, limit, total) },
  })
})

export const approveEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, status: 'pending_approval' })
  if (!event) {
    return sendTsRestError(res, 404, 'No pending event found with this id')
  }

  event.status = 'approved'
  event.publishedAt = new Date()
  await event.save()

  User.findById(event.organizer)
    .then(organizer => {
      // Opt-in — defaults to off, see organizerNotificationPreferences on
      // the User model and the "Event approvals" toggle on Settings.
      if (organizer && organizer.organizerNotificationPreferences?.eventApprovals) {
        EmailService.sendEventApprovedEmail(organizer, event.title).catch(error =>
          logger.error({ err: error }, `Event-approved email failed for event ${event._id}`)
        )
      }
    })
    .catch(error => logger.error({ err: error }, `Could not load organizer for event ${event._id}`))

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event approved',
    body: event.toObject(),
  })
})

export const rejectEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const { reason } = req.body

  const event = await Event.findOne({ _id: id, status: 'pending_approval' })
  if (!event) {
    return sendTsRestError(res, 404, 'No pending event found with this id')
  }

  event.status = 'rejected'
  event.rejectionReason = reason
  await event.save()

  User.findById(event.organizer)
    .then(organizer => {
      if (organizer && organizer.organizerNotificationPreferences?.eventApprovals) {
        EmailService.sendEventRejectedEmail(organizer, event.title, reason).catch(error =>
          logger.error({ err: error }, `Event-rejected email failed for event ${event._id}`)
        )
      }
    })
    .catch(error => logger.error({ err: error }, `Could not load organizer for event ${event._id}`))

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event rejected',
    body: event.toObject(),
  })
})

export const approveEventPromotion = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findById(id)
  if (!event || !event.promotion) {
    return sendTsRestError(res, 404, 'No promotion request found for this event')
  }
  if (!event.promotion.paidAt) {
    return sendTsRestError(res, 400, 'Promotion payment has not been confirmed yet')
  }

  const pkg = getPromotionPackage(event.promotion.package)
  const durationDays = pkg?.durationDays ?? 7
  const startsAt = new Date()
  const endsAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000)

  event.promotion.status = 'approved'
  event.promotion.startsAt = startsAt
  event.promotion.endsAt = endsAt
  event.isPromoted = true
  await event.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Promotion approved',
    body: event.toObject(),
  })
})

export const rejectEventPromotion = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findById(id)
  if (!event || !event.promotion) {
    return sendTsRestError(res, 404, 'No promotion request found for this event')
  }

  event.promotion.status = 'rejected'
  event.isPromoted = false
  await event.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Promotion rejected',
    body: event.toObject(),
  })
})

export const listRefundRequests = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)
  const status = typeof req.query.status === 'string' ? req.query.status : 'pending'
  const filter = { status }

  const [refundRequests, total] = await Promise.all([
    RefundRequest.find(filter)
      .populate('event', 'title slug')
      .populate('requestedBy', 'fullname email')
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    RefundRequest.countDocuments(filter),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Refund requests fetched',
    body: { refundRequests, meta: buildPaginationMeta(page, limit, total) },
  })
})

export const approveRefundRequest = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params

  const refundRequest = await RefundRequest.findOne({ _id: id, status: 'pending' })
  if (!refundRequest) {
    return sendTsRestError(res, 404, 'No pending refund request found with this id')
  }

  const [ticket, order] = await Promise.all([
    Ticket.findById(refundRequest.ticket),
    Order.findById(refundRequest.order),
  ])
  if (!ticket || !order) {
    return sendTsRestError(res, 404, 'The ticket or order for this request no longer exists')
  }

  try {
    const refund = await PaystackService.refundTransaction({
      transactionReference: order.paystackReference,
      amountKobo: Math.round(refundRequest.amount * 100),
      reason: refundRequest.reason,
    })

    ticket.status = 'refunded'
    await ticket.save()

    order.refundAmount = (order.refundAmount ?? 0) + refundRequest.amount
    const remainingValidTickets = await Ticket.countDocuments({
      order: order._id,
      status: { $in: ['valid', 'checked_in'] },
    })
    order.status = remainingValidTickets > 0 ? 'partially_refunded' : 'refunded'
    if (!order.refundedAt) order.refundedAt = new Date()
    await order.save()

    refundRequest.status = 'processed'
    refundRequest.paystackRefundReference = refund.reference
    refundRequest.processedAt = new Date()
    await refundRequest.save()

    Promise.all([User.findById(refundRequest.requestedBy), Event.findById(refundRequest.event)])
      .then(([requester, event]) => {
        if (requester && event) {
          EmailService.sendRefundProcessedEmail(
            requester,
            event.title,
            `₦${refundRequest.amount.toLocaleString('en-NG')}`
          ).catch(error => logger.error({ err: error }, `Refund-processed email failed for request ${refundRequest._id}`))
        }
      })
      .catch(error => logger.error({ err: error }, `Could not load requester/event for refund ${refundRequest._id}`))

    return sendTsRestSuccess(res, 200, {
      success: true,
      message: 'Refund processed',
      body: refundRequest.toObject(),
    })
  } catch (error: any) {
    return sendTsRestError(res, 502, error.message || 'Refund failed with Paystack')
  }
})

export const rejectRefundRequest = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const { reason } = req.body as { reason?: string }

  const refundRequest = await RefundRequest.findOne({ _id: id, status: 'pending' })
  if (!refundRequest) {
    return sendTsRestError(res, 404, 'No pending refund request found with this id')
  }

  refundRequest.status = 'rejected'
  refundRequest.rejectionReason = reason
  await refundRequest.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Refund request rejected',
    body: refundRequest.toObject(),
  })
})
