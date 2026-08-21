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
 * A few things the Figma shows have no backing data model yet (flagged
 * events, payment disputes, a distinct refund "investigate" queue, and any
 * kind of admin-action audit trail) — those come back as `null`/empty here
 * rather than a made-up number, and the client renders an honest
 * "not tracked yet" state for them instead of a fake stat.
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
  ] = await Promise.all([
    Event.countDocuments({ status: 'pending_approval' }),
    User.countDocuments({ role: 'organizer', 'organizerProfile.approvalStatus': 'pending' }),
    Event.countDocuments({ 'promotion.status': 'pending', 'promotion.paidAt': { $exists: true } }),
    RefundRequest.countDocuments({ status: 'pending' }),
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
        flaggedEventsCount: null,
        openPaymentDisputesCount: null,
        refundRate30d,
        newOrganizersToday,
      },
      topOrganizers: topOrganizersAgg,
      // No admin-action audit trail exists yet (approvals/rejections just
      // mutate the document directly) — empty for now rather than invented
      // entries. See getAdminOverview's doc comment.
      recentActivity: [],
    },
  })
})
