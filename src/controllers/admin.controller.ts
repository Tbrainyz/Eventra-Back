import { Request, Response } from 'express'
import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { getPromotionPackage } from '../config/promotionPackages.js'
import logger from '../config/logger.js'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import { buildPaginationMeta, escapeRegExp, generateOTP, getPagination, sanitizeUser } from '../lib/utils.js'
import { invalidateUserSessions } from '../lib/sessionStore.js'
import { initiateOrderPayout } from '../jobs/payoutCron.js'
import { logAdminAction } from '../lib/auditLog.js'
import { getPlatformSettings, updatePlatformSettings } from '../lib/platformSettings.js'
import AuditLog from '../models/auditLog.js'
import Dispute from '../models/dispute.js'
import Event from '../models/event.js'
import Order from '../models/order.js'
import RefundRequest from '../models/refundRequest.js'
import Report from '../models/report.js'
import Ticket from '../models/ticket.js'
import TicketType from '../models/ticketType.js'
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
  await logAdminAction(req, 'Suspended user', user.organizerProfile?.businessName || user.fullname)

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
  await logAdminAction(req, 'Reinstated user', user.organizerProfile?.businessName || user.fullname)

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
  await logAdminAction(req, 'Verified organizer', organizer.organizerProfile.businessName || organizer.fullname)

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
  await logAdminAction(req, 'Rejected organizer', organizer.organizerProfile.businessName || organizer.fullname)

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
  await logAdminAction(req, 'Approved event', event.title || 'Untitled event')

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
  await logAdminAction(req, 'Rejected event', event.title || 'Untitled event')

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
  await logAdminAction(req, 'Approved promotion', event.title || 'Untitled event')

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
  await logAdminAction(req, 'Rejected promotion', event.title || 'Untitled event')

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

    await logAdminAction(req, `Issued refund ₦${refundRequest.amount.toLocaleString('en-NG')}`, ticket.attendeeName)

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
  await logAdminAction(req, 'Declined refund request', `₦${refundRequest.amount.toLocaleString('en-NG')}`)

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Refund request rejected',
    body: refundRequest.toObject(),
  })
})

export const getEventDetailForAdmin = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params

  const [event, ticketTypes] = await Promise.all([
    Event.findById(id)
      .populate('organizer', 'fullname email organizerProfile.businessName organizerProfile.approvalStatus')
      .populate('category', 'name')
      .lean(),
    TicketType.find({ event: id }).sort({ price: 1 }).lean(),
  ])

  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event fetched',
    body: { ...event, ticketTypes },
  })
})

export const getOrganizerDetailForAdmin = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params

  const organizer = await User.findOne({ _id: id, role: 'organizer' }).select('-password').lean()
  if (!organizer || !organizer.organizerProfile) {
    return sendTsRestError(res, 404, 'Organizer not found')
  }

  const [eventsRunCount, salesAgg, recentEvents] = await Promise.all([
    Event.countDocuments({ organizer: id, status: { $in: ['approved', 'postponed'] } }),
    Order.aggregate([
      { $match: { status: { $in: ['paid', 'partially_refunded'] } } },
      { $lookup: { from: 'events', localField: 'event', foreignField: '_id', as: 'eventDoc' } },
      { $unwind: '$eventDoc' },
      { $match: { 'eventDoc.organizer': organizer._id } },
      {
        $group: {
          _id: null,
          ticketsSold: { $sum: { $sum: '$items.quantity' } },
          revenue: { $sum: '$subtotal' },
          paidOut: { $sum: { $cond: [{ $eq: ['$payoutStatus', 'paid'] }, '$organizerEarnings', 0] } },
        },
      },
    ]),
    Event.find({ organizer: id }).select('title slug status ticketsSoldCount capacity').sort({ createdAt: -1 }).limit(5).lean(),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Organizer fetched',
    body: {
      ...sanitizeUser(organizer),
      eventsRunCount,
      ticketsSold: salesAgg[0]?.ticketsSold ?? 0,
      revenue: salesAgg[0]?.revenue ?? 0,
      paidOut: salesAgg[0]?.paidOut ?? 0,
      recentEvents: recentEvents.map(e => ({ _id: e._id, title: e.title, slug: e.slug, status: e.status, sold: e.ticketsSoldCount, capacity: e.capacity })),
    },
  })
})

export const getRefundRequestDetail = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params

  const refundRequest = await RefundRequest.findById(id)
    .populate('event', 'title slug refundPolicy')
    .populate('requestedBy', 'fullname email')
    .populate('ticket', 'attendeeName attendeeEmail')
    .populate('order', 'paystackReference')
    .lean()

  if (!refundRequest) {
    return sendTsRestError(res, 404, 'Refund request not found')
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Refund request fetched',
    body: refundRequest,
  })
})

export const listEventsForAdmin = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)
  const filter: Record<string, any> = {}

  const tab = typeof req.query.tab === 'string' ? req.query.tab : 'all'
  if (tab === 'pending') filter.status = 'pending_approval'
  else if (tab === 'live') filter.status = { $in: ['approved', 'postponed'] }
  else if (tab === 'flagged') filter.flagged = true
  else if (tab === 'past') {
    filter.status = { $in: ['approved', 'postponed'] }
    filter.endDate = { $lt: new Date() }
  } else if (tab === 'rejected') filter.status = 'rejected'

  if (req.query.q && typeof req.query.q === 'string') {
    filter.title = new RegExp(escapeRegExp(req.query.q), 'i')
  }

  const [events, total] = await Promise.all([
    Event.find(filter)
      .populate('organizer', 'fullname organizerProfile.businessName')
      .select('title slug type status flagged ticketsSoldCount capacity startDate createdAt organizer')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Event.countDocuments(filter),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Events fetched',
    body: { events, meta: buildPaginationMeta(page, limit, total) },
  })
})

export const flagEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const { reason } = req.body as { reason?: string }

  const event = await Event.findByIdAndUpdate(id, { flagged: true, flagReason: reason }, { new: true })
  if (!event) return sendTsRestError(res, 404, 'Event not found')
  await logAdminAction(req, 'Flagged event', event.title || 'Untitled event')

  return sendTsRestSuccess(res, 200, { success: true, message: 'Event flagged', body: event.toObject() })
})

export const unflagEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params

  const event = await Event.findByIdAndUpdate(id, { flagged: false, $unset: { flagReason: 1 } }, { new: true })
  if (!event) return sendTsRestError(res, 404, 'Event not found')
  await logAdminAction(req, 'Cleared flag', event.title || 'Untitled event')

  return sendTsRestSuccess(res, 200, { success: true, message: 'Flag dismissed', body: event.toObject() })
})

// Distinct from an organizer cancelling their own event (status:
// 'cancelled', which still shows on the organizer's own dashboard as a
// cancelled event they own) — 'removed' is an admin takedown, unpublished
// site-wide the same way listPublicEvents already only ever matches
// status: 'approved'/'postponed'.
export const removeEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const { reason } = req.body as { reason?: string }

  const event = await Event.findByIdAndUpdate(id, { status: 'removed', removedReason: reason, flagged: false }, { new: true })
  if (!event) return sendTsRestError(res, 404, 'Event not found')
  await logAdminAction(req, 'Removed event', event.title || 'Untitled event')

  return sendTsRestSuccess(res, 200, { success: true, message: 'Event removed', body: event.toObject() })
})

export const listOrganizersForAdmin = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)
  const filter: Record<string, any> = { role: 'organizer', organizerProfile: { $exists: true } }

  const tab = typeof req.query.tab === 'string' ? req.query.tab : 'all'
  if (tab === 'verified') filter['organizerProfile.approvalStatus'] = 'approved'
  else if (tab === 'pending') filter['organizerProfile.approvalStatus'] = 'pending'
  else if (tab === 'suspended') filter.isSuspended = true

  if (req.query.q && typeof req.query.q === 'string') {
    const term = new RegExp(escapeRegExp(req.query.q), 'i')
    filter.$or = [{ fullname: term }, { 'organizerProfile.businessName': term }, { email: term }]
  }

  const [organizers, total] = await Promise.all([
    User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ])

  const organizerIds = organizers.map(o => o._id)
  const statsAgg = await Order.aggregate([
    { $match: { status: { $in: ['paid', 'partially_refunded'] } } },
    { $lookup: { from: 'events', localField: 'event', foreignField: '_id', as: 'eventDoc' } },
    { $unwind: '$eventDoc' },
    { $match: { 'eventDoc.organizer': { $in: organizerIds } } },
    { $group: { _id: '$eventDoc.organizer', revenue: { $sum: '$subtotal' } } },
  ])
  const [eventCounts] = [
    await Event.aggregate([
      { $match: { organizer: { $in: organizerIds }, status: { $in: ['approved', 'postponed'] } } },
      { $group: { _id: '$organizer', count: { $sum: 1 } } },
    ]),
  ]
  const revenueByOrganizer = new Map(statsAgg.map(s => [String(s._id), s.revenue]))
  const eventCountByOrganizer = new Map(eventCounts.map(s => [String(s._id), s.count]))

  const body = organizers.map(o => ({
    ...sanitizeUser(o),
    eventsCount: eventCountByOrganizer.get(String(o._id)) ?? 0,
    revenue: revenueByOrganizer.get(String(o._id)) ?? 0,
  }))

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Organizers fetched',
    body: { organizers: body, meta: buildPaginationMeta(page, limit, total) },
  })
})

export const listAttendeesForAdmin = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)
  const filter: Record<string, any> = { role: 'attendee' }

  const tab = typeof req.query.tab === 'string' ? req.query.tab : 'all'
  if (tab === 'active') filter.isSuspended = { $ne: true }
  else if (tab === 'suspended') filter.isSuspended = true

  if (req.query.q && typeof req.query.q === 'string') {
    const term = new RegExp(escapeRegExp(req.query.q), 'i')
    filter.$or = [{ fullname: term }, { email: term }]
  }

  const [users, total] = await Promise.all([
    User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ])

  const userIds = users.map(u => u._id)
  const statsAgg = await Order.aggregate([
    { $match: { buyer: { $in: userIds }, status: { $in: ['paid', 'partially_refunded'] } } },
    { $group: { _id: '$buyer', orders: { $sum: 1 }, spent: { $sum: '$subtotal' } } },
  ])
  const statsByUser = new Map(statsAgg.map(s => [String(s._id), s]))

  const body = users.map(u => ({
    ...sanitizeUser(u),
    ordersCount: statsByUser.get(String(u._id))?.orders ?? 0,
    totalSpent: statsByUser.get(String(u._id))?.spent ?? 0,
  }))

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Users fetched',
    body: { users: body, meta: buildPaginationMeta(page, limit, total) },
  })
})

export const getAttendeeDetailForAdmin = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params

  const user = await User.findOne({ _id: id, role: 'attendee' }).select('-password').lean()
  if (!user) return sendTsRestError(res, 404, 'User not found')

  const [statsAgg, orders] = await Promise.all([
    Order.aggregate([
      { $match: { buyer: user._id, status: { $in: ['paid', 'partially_refunded'] } } },
      { $group: { _id: null, orders: { $sum: 1 }, spent: { $sum: '$subtotal' } } },
    ]),
    Order.find({ buyer: user._id, status: { $in: ['paid', 'partially_refunded', 'refunded'] } })
      .populate('event', 'title slug')
      .select('event subtotal createdAt status')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'User fetched',
    body: {
      ...sanitizeUser(user),
      ordersCount: statsAgg[0]?.orders ?? 0,
      totalSpent: statsAgg[0]?.spent ?? 0,
      orderHistory: orders.map(o => ({ event: o.event, amount: o.subtotal, status: o.status, createdAt: o.createdAt })),
    },
  })
})

export const getAdminRevenue = tryCatchWrapper(async (req: Request, res: Response) => {
  const now = new Date()
  const monthsBack = 6
  const seriesStart = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1)

  const [totalsAgg, promotedEvents, topEarningAgg, monthlyOrders, monthlyPromotedEvents] = await Promise.all([
    Order.aggregate([
      { $match: { status: { $in: ['paid', 'partially_refunded'] } } },
      { $group: { _id: null, grossSales: { $sum: '$subtotal' }, commissionRevenue: { $sum: '$platformFee' } } },
    ]),
    Event.find({ 'promotion.status': 'approved' }).select('promotion.package').lean(),
    Order.aggregate([
      { $match: { status: { $in: ['paid', 'partially_refunded'] } } },
      { $lookup: { from: 'events', localField: 'event', foreignField: '_id', as: 'eventDoc' } },
      { $unwind: '$eventDoc' },
      { $lookup: { from: 'users', localField: 'eventDoc.organizer', foreignField: '_id', as: 'organizerDoc' } },
      { $unwind: '$organizerDoc' },
      {
        $group: {
          _id: '$eventDoc._id',
          eventTitle: { $first: '$eventDoc.title' },
          organizerName: { $first: { $ifNull: ['$organizerDoc.organizerProfile.businessName', '$organizerDoc.fullname'] } },
          commission: { $sum: '$platformFee' },
        },
      },
      { $sort: { commission: -1 } },
      { $limit: 4 },
    ]),
    Order.find({ status: { $in: ['paid', 'partially_refunded'] }, createdAt: { $gte: seriesStart } })
      .select('subtotal platformFee createdAt')
      .lean(),
    Event.find({ 'promotion.status': 'approved', 'promotion.paidAt': { $gte: seriesStart } })
      .select('promotion.package promotion.paidAt')
      .lean(),
  ])

  const grossTicketSales = totalsAgg[0]?.grossSales ?? 0
  const commissionRevenue = totalsAgg[0]?.commissionRevenue ?? 0
  const promotionRevenue = promotedEvents.reduce((sum, e) => sum + (getPromotionPackage(e.promotion?.package)?.priceNaira ?? 0), 0)
  const platformRevenue = commissionRevenue + promotionRevenue

  const months = Array.from({ length: monthsBack }, (_, i) => {
    const d = new Date(seriesStart.getFullYear(), seriesStart.getMonth() + i, 1)
    return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-NG', { month: 'short' }), grossSales: 0, commission: 0, promotion: 0 }
  })
  const monthIndex = new Map(months.map((m, i) => [m.key, i]))

  for (const order of monthlyOrders) {
    const d = new Date(order.createdAt)
    const i = monthIndex.get(`${d.getFullYear()}-${d.getMonth()}`)
    if (i !== undefined) {
      months[i].grossSales += order.subtotal
      months[i].commission += order.platformFee
    }
  }
  for (const event of monthlyPromotedEvents) {
    const paidAt = event.promotion?.paidAt
    if (!paidAt) continue
    const d = new Date(paidAt)
    const i = monthIndex.get(`${d.getFullYear()}-${d.getMonth()}`)
    const pkg = getPromotionPackage(event.promotion?.package)
    if (i !== undefined && pkg) months[i].promotion += pkg.priceNaira
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Revenue fetched',
    body: {
      grossTicketSales,
      commissionRevenue,
      promotionRevenue,
      platformRevenue,
      topEarningEvents: topEarningAgg.map(e => ({ eventId: e._id, eventTitle: e.eventTitle, organizerName: e.organizerName, commission: e.commission })),
      monthlyBreakdown: months.map(m => ({ label: m.label, grossSales: m.grossSales, commission: m.commission, promotion: m.promotion, total: m.commission + m.promotion })),
    },
  })
})

const PAYOUT_DELAY_DAYS = 3

export const getAdminPayoutsOverview = tryCatchWrapper(async (req: Request, res: Response) => {
  const cutoff = new Date(Date.now() - PAYOUT_DELAY_DAYS * 24 * 60 * 60 * 1000)

  const [heldAgg, readyAgg, paidAgg, commissionAgg, eventCount] = await Promise.all([
    Order.aggregate([
      { $match: { status: { $in: ['paid', 'partially_refunded'] }, payoutStatus: { $in: ['pending', 'processing'] } } },
      { $group: { _id: null, total: { $sum: '$organizerEarnings' } } },
    ]),
    Order.aggregate([
      { $match: { status: 'paid', payoutStatus: 'pending' } },
      { $lookup: { from: 'events', localField: 'event', foreignField: '_id', as: 'eventDoc' } },
      { $unwind: '$eventDoc' },
      { $match: { 'eventDoc.startDate': { $lte: cutoff } } },
      { $group: { _id: null, total: { $sum: '$organizerEarnings' } } },
    ]),
    Order.aggregate([
      { $match: { payoutStatus: 'paid' } },
      { $group: { _id: null, total: { $sum: '$organizerEarnings' } } },
    ]),
    Order.aggregate([
      { $match: { status: { $in: ['paid', 'partially_refunded'] } } },
      { $group: { _id: null, total: { $sum: '$platformFee' } } },
    ]),
    Order.aggregate([
      { $match: { status: { $in: ['paid', 'partially_refunded'] }, payoutStatus: { $in: ['pending', 'processing'] } } },
      { $group: { _id: '$event' } },
      { $count: 'count' },
    ]),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Payouts overview fetched',
    body: {
      heldInEscrow: heldAgg[0]?.total ?? 0,
      heldInEscrowEventsCount: eventCount[0]?.count ?? 0,
      readyToRelease: readyAgg[0]?.total ?? 0,
      paidOutAllTime: paidAgg[0]?.total ?? 0,
      commissionCollected: commissionAgg[0]?.total ?? 0,
    },
  })
})

export const listAwaitingPayouts = tryCatchWrapper(async (req: Request, res: Response) => {
  const cutoff = new Date(Date.now() - PAYOUT_DELAY_DAYS * 24 * 60 * 60 * 1000)

  const groups = await Order.aggregate([
    { $match: { status: 'paid', payoutStatus: { $in: ['pending', 'processing'] } } },
    { $lookup: { from: 'events', localField: 'event', foreignField: '_id', as: 'eventDoc' } },
    { $unwind: '$eventDoc' },
    { $lookup: { from: 'users', localField: 'eventDoc.organizer', foreignField: '_id', as: 'organizerDoc' } },
    { $unwind: '$organizerDoc' },
    {
      $group: {
        _id: { organizer: '$eventDoc.organizer', event: '$eventDoc._id' },
        organizerName: { $first: { $ifNull: ['$organizerDoc.organizerProfile.businessName', '$organizerDoc.fullname'] } },
        eventTitle: { $first: '$eventDoc.title' },
        eventStartDate: { $first: '$eventDoc.startDate' },
        amount: { $sum: '$organizerEarnings' },
        isProcessing: { $max: { $eq: ['$payoutStatus', 'processing'] } },
      },
    },
    { $sort: { eventStartDate: -1 } },
  ])

  const body = groups.map(g => {
    const releaseDate = g.eventStartDate ? new Date(new Date(g.eventStartDate).getTime() + PAYOUT_DELAY_DAYS * 24 * 60 * 60 * 1000) : null
    const status = g.isProcessing ? 'processing' : releaseDate && releaseDate <= new Date() ? 'ready' : 'held'
    return {
      organizerId: g._id.organizer,
      organizerName: g.organizerName,
      eventId: g._id.event,
      eventTitle: g.eventTitle,
      amount: g.amount,
      releaseDate,
      status,
    }
  })

  return sendTsRestSuccess(res, 200, { success: true, message: 'Awaiting payouts fetched', body })
})

export const listPayoutHistory = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)

  const groups = await Order.aggregate([
    { $match: { payoutStatus: 'paid' } },
    { $lookup: { from: 'events', localField: 'event', foreignField: '_id', as: 'eventDoc' } },
    { $unwind: '$eventDoc' },
    { $lookup: { from: 'users', localField: 'eventDoc.organizer', foreignField: '_id', as: 'organizerDoc' } },
    { $unwind: '$organizerDoc' },
    {
      $group: {
        _id: { organizer: '$eventDoc.organizer', event: '$eventDoc._id' },
        organizerName: { $first: { $ifNull: ['$organizerDoc.organizerProfile.businessName', '$organizerDoc.fullname'] } },
        eventTitle: { $first: '$eventDoc.title' },
        amount: { $sum: '$organizerEarnings' },
        paidAt: { $max: '$updatedAt' },
      },
    },
    { $sort: { paidAt: -1 } },
    { $skip: skip },
    { $limit: limit },
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Payout history fetched',
    body: {
      payouts: groups.map(g => ({ organizerName: g.organizerName, eventTitle: g.eventTitle, amount: g.amount, paidAt: g.paidAt })),
      meta: buildPaginationMeta(page, limit, groups.length),
    },
  })
})

// Manually releases payout early for one organizer+event pair, bypassing
// the cron's PAYOUT_DELAY_DAYS wait — an admin override for cases like a
// trusted organizer needing funds before the standard hold clears.
// Reuses initiateOrderPayout so this can never diverge from what the cron
// itself does per order; once payoutStatus flips to 'processing' here the
// cron's own `payoutStatus: 'pending'` filter just skips these orders on
// its next run, so there's no double-payment risk.
export const releaseEventPayout = tryCatchWrapper(async (req: Request, res: Response) => {
  const organizerId = String(req.params.organizerId)
  const eventId = String(req.params.eventId)

  const orders = await Order.aggregate([
    { $match: { event: new mongoose.Types.ObjectId(eventId), status: 'paid', payoutStatus: 'pending' } },
    { $lookup: { from: 'events', localField: 'event', foreignField: '_id', as: 'eventDoc' } },
    { $unwind: '$eventDoc' },
    { $match: { 'eventDoc.organizer': new mongoose.Types.ObjectId(organizerId) } },
  ])

  if (orders.length === 0) {
    return sendTsRestError(res, 404, 'No orders awaiting payout for this organizer/event')
  }

  let released = 0
  let failed = 0
  let releasedAmount = 0
  for (const order of orders) {
    const result = await initiateOrderPayout(order)
    if (result.ok) {
      released++
      releasedAmount += order.organizerEarnings
    } else {
      failed++
    }
  }
  if (released > 0) {
    await logAdminAction(req, `Released payout ₦${releasedAmount.toLocaleString('en-NG')}`, orders[0].eventDoc?.title || 'event')
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: `Released ${released} payout${released === 1 ? '' : 's'}${failed > 0 ? `, ${failed} failed` : ''}`,
    body: { released, failed },
  })
})

type AdminRevenuePeriod = '7d' | '30d' | '12m'

/**
 * Buckets platform revenue (commission on paid orders + approved promotion
 * fees) for the Overview chart. Daily buckets for 7d/30d — same shape as
 * organizer.controller.ts's buildRevenueSeries — but 12m buckets by
 * calendar month instead, since "week-of-month" buckets don't make sense
 * across a whole year.
 *
 * Promotion fees don't have their own dated ledger the way orders do (an
 * event only ever holds one `promotion` sub-document, not a payment
 * history), so an approved promotion's fee is attributed to
 * `promotion.paidAt` — the moment it was actually paid for.
 */
async function buildPlatformRevenueSeries(period: AdminRevenuePeriod): Promise<{ label: string; amount: number }[]> {
  const now = new Date()

  if (period === '12m') {
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
      return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-NG', { month: 'short' }), amount: 0 }
    })
    const bucketIndex = new Map(buckets.map((b, i) => [b.key, i]))

    const [orders, promotedEvents] = await Promise.all([
      Order.find({ status: { $in: ['paid', 'partially_refunded'] }, createdAt: { $gte: start } })
        .select('platformFee createdAt')
        .lean(),
      Event.find({ 'promotion.status': 'approved', 'promotion.paidAt': { $gte: start } })
        .select('promotion.package promotion.paidAt')
        .lean(),
    ])

    for (const order of orders) {
      const d = new Date(order.createdAt)
      const i = bucketIndex.get(`${d.getFullYear()}-${d.getMonth()}`)
      if (i !== undefined) buckets[i].amount += order.platformFee
    }
    for (const event of promotedEvents) {
      const paidAt = event.promotion?.paidAt
      if (!paidAt) continue
      const d = new Date(paidAt)
      const i = bucketIndex.get(`${d.getFullYear()}-${d.getMonth()}`)
      const pkg = getPromotionPackage(event.promotion?.package)
      if (i !== undefined && pkg) buckets[i].amount += pkg.priceNaira
    }

    return buckets.map(({ label, amount }) => ({ label, amount }))
  }

  const days = period === '7d' ? 7 : 30
  const start = new Date(now)
  start.setDate(start.getDate() - (days - 1))
  start.setHours(0, 0, 0, 0)

  const dayKey = (d: Date) => new Date(d).toISOString().slice(0, 10)
  const buckets = new Map<string, number>()
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    buckets.set(dayKey(d), 0)
  }

  const [orders, promotedEvents] = await Promise.all([
    Order.find({ status: { $in: ['paid', 'partially_refunded'] }, createdAt: { $gte: start } })
      .select('platformFee createdAt')
      .lean(),
    Event.find({ 'promotion.status': 'approved', 'promotion.paidAt': { $gte: start } })
      .select('promotion.package promotion.paidAt')
      .lean(),
  ])

  for (const order of orders) {
    const key = dayKey(order.createdAt)
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + order.platformFee)
  }
  for (const event of promotedEvents) {
    const paidAt = event.promotion?.paidAt
    if (!paidAt) continue
    const key = dayKey(paidAt)
    const pkg = getPromotionPackage(event.promotion?.package)
    if (buckets.has(key) && pkg) buckets.set(key, (buckets.get(key) ?? 0) + pkg.priceNaira)
  }

  return Array.from(buckets.entries()).map(([date, amount]) => ({ label: date, amount }))
}

// null (not 0%) when there's no prior-period baseline to compare against —
// same reasoning as organizer.controller.ts's percentChange.
const percentChange = (current: number, previous: number): number | null =>
  previous > 0 ? Math.round(((current - previous) / previous) * 100) : null

/**
 * The Admin Console's Overview screen — everything above the fold: the
 * "needs your attention" counts, the four top stat cards, the platform
 * revenue chart, and the Top Organizers ranking. All computed live from
 * Event/User/Order/RefundRequest — nothing here is cached or pre-aggregated.
 *
 * A couple of things the Figma shows still have no backing data model
 * (a distinct refund "investigate" queue split from the routine pending
 * queue) — that comes back as `null` here rather than a made-up number.
 * Flagged events, payment disputes, and recent activity are all real now
 * — see the Report, Dispute, and AuditLog models.
 */
export const getAdminOverview = tryCatchWrapper(async (req: Request, res: Response) => {
  const period: AdminRevenuePeriod = req.query.period === '7d' || req.query.period === '12m' ? req.query.period : '30d'

  const now = new Date()
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

  const [
    pendingEventsCount,
    organizersToVerifyCount,
    promotionsPendingCount,
    pendingRefundsCount,
    flaggedEventsCount,
    salesAgg,
    approvedPromotedEvents,
    activeEventsCount,
    organizersWithActiveEvent,
    escrowAgg,
    periodTotals,
    grossLast30d,
    refundedLast30d,
    newOrganizersToday,
    topOrganizersAgg,
    revenueSeries,
    recentActivity,
    openDisputesCount,
  ] = await Promise.all([
    Event.countDocuments({ status: 'pending_approval' }),
    User.countDocuments({ role: 'organizer', 'organizerProfile.approvalStatus': 'pending' }),
    Event.countDocuments({ 'promotion.status': 'pending', 'promotion.paidAt': { $exists: true } }),
    RefundRequest.countDocuments({ status: 'pending' }),
    Event.countDocuments({ flagged: true }),
    Order.aggregate([
      { $match: { status: { $in: ['paid', 'partially_refunded'] } } },
      { $group: { _id: null, grossSales: { $sum: '$subtotal' }, commissionRevenue: { $sum: '$platformFee' } } },
    ]),
    Event.find({ 'promotion.status': 'approved' }).select('promotion.package').lean(),
    Event.countDocuments({ status: { $in: ['approved', 'postponed'] } }),
    Event.distinct('organizer', { status: { $in: ['approved', 'postponed'] } }),
    Order.aggregate([
      {
        $match: {
          status: { $in: ['paid', 'partially_refunded'] },
          payoutStatus: { $in: ['not_due', 'pending', 'processing'] },
        },
      },
      { $group: { _id: null, held: { $sum: '$organizerEarnings' } } },
    ]),
    // "vs last month" on the Platform Revenue stat card — commission only,
    // same as the chart series (promotion fees are folded in separately
    // below since they're not on the Order model).
    Order.aggregate([
      { $match: { status: { $in: ['paid', 'partially_refunded'] }, createdAt: { $gte: sixtyDaysAgo } } },
      {
        $group: {
          _id: { $cond: [{ $gte: ['$createdAt', thirtyDaysAgo] }, 'current', 'previous'] },
          platformFee: { $sum: '$platformFee' },
        },
      },
    ]),
    Order.aggregate([
      { $match: { status: { $in: ['paid', 'partially_refunded', 'refunded'] }, createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, gross: { $sum: '$subtotal' } } },
    ]),
    Order.aggregate([
      { $match: { refundedAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, refunded: { $sum: '$refundAmount' } } },
    ]),
    User.countDocuments({ role: 'organizer', createdAt: { $gte: startOfToday } }),
    Order.aggregate([
      { $match: { status: { $in: ['paid', 'partially_refunded'] } } },
      { $lookup: { from: 'events', localField: 'event', foreignField: '_id', as: 'eventDoc' } },
      { $unwind: '$eventDoc' },
      { $group: { _id: '$eventDoc.organizer', grossSales: { $sum: '$subtotal' } } },
      { $sort: { grossSales: -1 } },
      { $limit: 4 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'organizer' } },
      { $unwind: '$organizer' },
      {
        $project: {
          _id: 0,
          organizerId: '$organizer._id',
          businessName: { $ifNull: ['$organizer.organizerProfile.businessName', '$organizer.fullname'] },
          grossSales: 1,
        },
      },
    ]),
    buildPlatformRevenueSeries(period),
    AuditLog.find().sort({ createdAt: -1 }).limit(5).lean(),
    Dispute.countDocuments({ status: { $nin: ['resolved', 'accepted-loss'] } }),
  ])

  const grossTicketSales = salesAgg[0]?.grossSales ?? 0
  const commissionRevenue = salesAgg[0]?.commissionRevenue ?? 0
  const promotionRevenue = approvedPromotedEvents.reduce((sum, event) => {
    const pkg = getPromotionPackage(event.promotion?.package)
    return sum + (pkg?.priceNaira ?? 0)
  }, 0)
  const platformRevenue = commissionRevenue + promotionRevenue
  const heldInEscrow = escrowAgg[0]?.held ?? 0

  const currentPlatformFee = periodTotals.find(p => p._id === 'current')?.platformFee ?? 0
  const previousPlatformFee = periodTotals.find(p => p._id === 'previous')?.platformFee ?? 0

  const gross30d = grossLast30d[0]?.gross ?? 0
  const refunded30d = refundedLast30d[0]?.refunded ?? 0
  const refundRate30d = gross30d > 0 ? Math.round((refunded30d / gross30d) * 1000) / 10 : 0

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Admin overview fetched',
    body: {
      needsAction: {
        pendingEventsCount,
        organizersToVerifyCount,
        promotionsPendingCount,
        pendingRefundsCount,
        // No distinction in the data model between a routine refund
        // request and one that needs escalation — see the note above
        // getAdminOverview. `null` here, not a fabricated count.
        refundsToInvestigateCount: null,
      },
      stats: {
        grossTicketSales,
        platformRevenue,
        // Commission-only comparison — promotion revenue isn't dated
        // finely enough (see buildPlatformRevenueSeries) to include in a
        // clean period-over-period delta.
        platformRevenueChangePct: percentChange(currentPlatformFee, previousPlatformFee),
        heldInEscrow,
        activeEventsCount,
        activeOrganizersCount: organizersWithActiveEvent.length,
      },
      revenueSeries,
      trustAndSafety: {
        flaggedEventsCount,
        openPaymentDisputesCount: openDisputesCount,
        refundRate30d,
        newOrganizersToday,
      },
      topOrganizers: topOrganizersAgg,
      recentActivity: recentActivity.map(entry => ({
        _id: entry._id,
        message: `${entry.action} — ${entry.targetLabel}`,
        actor: entry.adminName,
        createdAt: entry.createdAt,
      })),
    },
  })
})

// ---------------------------------------------------------------------------
// Reports (Flags + Audit log)
// ---------------------------------------------------------------------------

export const listFlags = tryCatchWrapper(async (req: Request, res: Response) => {
  const [eventGroups, organizerGroups] = await Promise.all([
    Report.aggregate([
      { $match: { targetType: 'event', status: 'open' } },
      { $group: { _id: '$event', reportCount: { $sum: 1 }, latestReason: { $last: '$reason' } } },
      { $lookup: { from: 'events', localField: '_id', foreignField: '_id', as: 'eventDoc' } },
      { $unwind: '$eventDoc' },
      { $sort: { reportCount: -1 } },
    ]),
    Report.aggregate([
      { $match: { targetType: 'organizer', status: 'open' } },
      { $group: { _id: '$organizer', reportCount: { $sum: 1 }, latestReason: { $last: '$reason' } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'organizerDoc' } },
      { $unwind: '$organizerDoc' },
      { $sort: { reportCount: -1 } },
    ]),
  ])

  const flags = [
    ...eventGroups.map(g => ({
      targetType: 'event' as const,
      targetId: g._id,
      subject: g.eventDoc.title || 'Untitled event',
      reason: g.latestReason,
      reportCount: g.reportCount,
    })),
    ...organizerGroups.map(g => ({
      targetType: 'organizer' as const,
      targetId: g._id,
      subject: `@${(g.organizerDoc.organizerProfile?.businessName || g.organizerDoc.fullname).toLowerCase().replace(/\s+/g, '_')}`,
      reason: g.latestReason,
      reportCount: g.reportCount,
    })),
  ]

  return sendTsRestSuccess(res, 200, { success: true, message: 'Flags fetched', body: flags })
})

export const getEventFlagDetail = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params

  const [event, reports] = await Promise.all([
    Event.findById(id).populate('organizer', 'fullname organizerProfile.businessName').populate('category', 'name').lean(),
    Report.find({ targetType: 'event', event: id, status: 'open' }).sort({ createdAt: -1 }).lean(),
  ])
  if (!event) return sendTsRestError(res, 404, 'Event not found')

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Flag detail fetched',
    body: {
      event: {
        _id: event._id,
        title: event.title,
        organizerName: (event.organizer as any)?.organizerProfile?.businessName || (event.organizer as any)?.fullname,
        categoryName: (event.category as any)?.name,
        startDate: event.startDate,
        venue: event.venue,
        isOnline: event.isOnline,
      },
      reports: reports.map(r => ({ _id: r._id, reason: r.reason, reporterName: r.reporterName, createdAt: r.createdAt })),
    },
  })
})

export const getOrganizerFlagDetail = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params

  const [organizer, reports, ordersCount] = await Promise.all([
    User.findOne({ _id: id, role: 'organizer' }).select('-password').lean(),
    Report.find({ targetType: 'organizer', organizer: id, status: 'open' }).sort({ createdAt: -1 }).lean(),
    Order.countDocuments({ buyer: id }),
  ])
  if (!organizer) return sendTsRestError(res, 404, 'Organizer not found')

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Flag detail fetched',
    body: {
      organizer: { ...sanitizeUser(organizer), ordersCount },
      reports: reports.map(r => ({ _id: r._id, reason: r.reason, reporterName: r.reporterName, createdAt: r.createdAt })),
    },
  })
})

export const dismissEventFlag = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params

  const event = await Event.findByIdAndUpdate(id, { flagged: false, $unset: { flagReason: 1 } }, { new: true })
  if (!event) return sendTsRestError(res, 404, 'Event not found')
  await Report.updateMany({ targetType: 'event', event: id, status: 'open' }, { status: 'dismissed' })
  await logAdminAction(req, 'Dismissed flag', event.title || 'Untitled event')

  return sendTsRestSuccess(res, 200, { success: true, message: 'Flag dismissed', body: event.toObject() })
})

export const dismissOrganizerFlag = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params

  const organizer = await User.findOne({ _id: id, role: 'organizer' })
  if (!organizer) return sendTsRestError(res, 404, 'Organizer not found')
  await Report.updateMany({ targetType: 'organizer', organizer: id, status: 'open' }, { status: 'dismissed' })
  await logAdminAction(req, 'Dismissed flag', organizer.organizerProfile?.businessName || organizer.fullname)

  return sendTsRestSuccess(res, 200, { success: true, message: 'Flag dismissed', body: sanitizeUser(organizer.toObject()) })
})

export const listAuditLog = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)

  const [entries, total] = await Promise.all([
    AuditLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Audit log fetched',
    body: { entries, meta: buildPaginationMeta(page, limit, total) },
  })
})

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const getSettings = tryCatchWrapper(async (req: Request, res: Response) => {
  const settings = await getPlatformSettings()

  const admins = await User.find({ role: 'admin' }).select('fullname email adminRole').sort({ createdAt: 1 }).lean()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Settings fetched',
    body: {
      commissionRatePercent: settings.commissionRatePercent,
      currency: settings.currency,
      payoutHoldDays: settings.payoutHoldDays,
      autoApproveEvents: settings.autoApproveEvents,
      autoApprovePromotions: settings.autoApprovePromotions,
      maintenanceMode: settings.maintenanceMode,
      admins: admins.map(a => ({ _id: a._id, fullname: a.fullname, email: a.email, adminRole: a.adminRole ?? 'admin' })),
    },
  })
})

export const updateSettings = tryCatchWrapper(async (req: Request, res: Response) => {
  const patch = req.body as Partial<{
    commissionRatePercent: number
    currency: string
    payoutHoldDays: number
    autoApproveEvents: boolean
    autoApprovePromotions: boolean
    maintenanceMode: boolean
  }>

  const settings = await updatePlatformSettings(patch)
  await logAdminAction(req, 'Updated platform settings', Object.keys(patch).join(', ') || 'settings')

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Settings updated',
    body: settings.toObject(),
  })
})

// Purely a display label — see the adminRole doc comment on the User
// model. Doesn't grant or revoke access to anything; every admin route
// still just checks requireAdmin (role === 'admin') the same as before.
export const updateAdminRole = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const { adminRole } = req.body as { adminRole: 'owner' | 'admin' | 'support' }

  const admin = await User.findOneAndUpdate({ _id: id, role: 'admin' }, { adminRole }, { new: true }).select('fullname email adminRole')
  if (!admin) return sendTsRestError(res, 404, 'Admin not found')

  // req.session.adminRole is only set at login — force this admin to log
  // back in so a demotion (or promotion) actually takes effect immediately
  // rather than whenever their existing session happens to expire. Same
  // reasoning as suspendUser already forcing a logout.
  await invalidateUserSessions(admin._id.toString())
  await logAdminAction(req, `Changed admin role to ${adminRole}`, admin.fullname)

  return sendTsRestSuccess(res, 200, { success: true, message: 'Admin role updated', body: { _id: admin._id, fullname: admin.fullname, email: admin.email, adminRole: admin.adminRole } })
})

const OTP_TTL_MS = 15 * 60 * 1000 // 15 minutes — matches auth.controller.ts's own OTP-flow copy

/**
 * Creates the invited admin's account outright (owner-only, see
 * requireAdminTier('owner') on the route) with a random, never-revealed
 * password, then routes them through the exact same "reset your password"
 * OTP email + /auth/reset-password page every attendee/organizer already
 * uses — rather than building a separate accept-invite token system.
 * They land on the same reset-password form, set a real password, and log
 * in normally from there.
 */
export const inviteAdmin = tryCatchWrapper(async (req: Request, res: Response) => {
  const { fullname, email, adminRole } = req.body as { fullname: string; email: string; adminRole: 'admin' | 'support' }

  const existing = await User.findOne({ email }).lean()
  if (existing) {
    return sendTsRestError(res, 409, 'An account with this email already exists')
  }

  const otp = generateOTP()
  const temporaryPassword = crypto.randomBytes(24).toString('hex') // never sent anywhere — they set their own via the reset flow below

  const admin = await User.create({
    fullname,
    email,
    password: temporaryPassword,
    role: 'admin',
    adminRole,
    isVerified: true, // owner-initiated, not self-registered — no need to re-verify the email address itself
    passwordResetOTP: otp,
    passwordResetOTPExpiry: new Date(Date.now() + OTP_TTL_MS),
  })

  await EmailService.sendPasswordResetEmail({ user: admin, otp })
    .then(() => {})
    .catch(error => logger.error({ err: error }, `Admin invite email failed for ${admin._id}`))

  await logAdminAction(req, `Invited ${adminRole}`, fullname)

  return sendTsRestSuccess(res, 201, {
    success: true,
    message: `Invited ${fullname} — they'll get an email to set their password`,
    body: { _id: admin._id, fullname: admin.fullname, email: admin.email, adminRole: admin.adminRole },
  })
})

// ---------------------------------------------------------------------------
// Disputes (Refunds & dispute > Disputes)
// ---------------------------------------------------------------------------

export const listDisputes = tryCatchWrapper(async (req: Request, res: Response) => {
  const disputes = await Dispute.find({ status: { $nin: ['resolved', 'accepted-loss'] } })
    .populate('event', 'title slug')
    .populate({ path: 'order', select: 'buyer guestName items', populate: { path: 'buyer', select: 'fullname email' } })
    .sort({ createdAt: -1 })
    .lean()

  const body = disputes.map(d => {
    const order = d.order as any
    const attendeeName = order?.buyer?.fullname || order?.guestName || 'Guest'
    return {
      _id: d._id,
      event: d.event,
      amount: d.amount,
      status: d.status,
      attendeeName,
      raisedAt: d.raisedAt,
    }
  })

  return sendTsRestSuccess(res, 200, { success: true, message: 'Disputes fetched', body })
})

export const getDisputeDetail = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params

  const dispute = await Dispute.findById(id)
    .populate('event', 'title slug')
    .populate({ path: 'order', select: 'buyer guestName guestEmail paystackReference', populate: { path: 'buyer', select: 'fullname email' } })
    .lean()
  if (!dispute) return sendTsRestError(res, 404, 'Dispute not found')

  const order = dispute.order as any

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Dispute fetched',
    body: {
      _id: dispute._id,
      event: dispute.event,
      amount: dispute.amount,
      status: dispute.status,
      raisedAt: dispute.raisedAt,
      resolvedAt: dispute.resolvedAt,
      attendeeName: order?.buyer?.fullname || order?.guestName || 'Guest',
      attendeeEmail: order?.buyer?.email || order?.guestEmail,
      paystackReference: order?.paystackReference,
    },
  })
})

export const challengeDispute = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const { serviceDetails } = req.body as { serviceDetails: string }

  const dispute = await Dispute.findById(id).populate({
    path: 'order',
    select: 'buyer guestName guestEmail',
    populate: { path: 'buyer', select: 'fullname email' },
  })
  if (!dispute) return sendTsRestError(res, 404, 'Dispute not found')

  const order = dispute.order as any
  await PaystackService.challengeDispute(dispute.paystackDisputeId, {
    customerEmail: order?.buyer?.email || order?.guestEmail || '',
    customerName: order?.buyer?.fullname || order?.guestName || 'Attendee',
    serviceDetails,
  })

  dispute.status = 'challenged'
  await dispute.save()
  await logAdminAction(req, 'Challenged dispute', `₦${dispute.amount.toLocaleString('en-NG')}`)

  return sendTsRestSuccess(res, 200, { success: true, message: 'Dispute challenged', body: dispute.toObject() })
})

export const acceptDisputeLoss = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params

  const dispute = await Dispute.findById(id)
  if (!dispute) return sendTsRestError(res, 404, 'Dispute not found')

  await PaystackService.acceptDisputeLoss(dispute.paystackDisputeId)

  dispute.status = 'accepted-loss'
  dispute.resolvedAt = new Date()
  await dispute.save()
  await logAdminAction(req, 'Accepted dispute loss', `₦${dispute.amount.toLocaleString('en-NG')}`)

  return sendTsRestSuccess(res, 200, { success: true, message: 'Dispute conceded — Paystack will refund the customer', body: dispute.toObject() })
})
