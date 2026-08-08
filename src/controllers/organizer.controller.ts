import { Request, Response } from 'express'
import mongoose from 'mongoose'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import { sanitizeUser } from '../lib/utils.js'
import Event from '../models/event.js'
import Order from '../models/order.js'
import Ticket from '../models/ticket.js'
import User, { IOrganizerProfile } from '../models/user.js'
import { PaystackService } from '../services/paystack.service.js'
import { deriveEventDisplayStatus } from '../lib/eventStatus.js'

/**
 * Create or update the caller's organizer profile (org info + bank
 * details). This is the wizard's "save as you go" endpoint — each step
 * (About your organization, Bank account) and "Save & exit" all call this
 * with just the fields that step collected, so it only ever merges over
 * the existing profile rather than replacing it.
 *
 * Submitting new bank details on an already-*approved* profile resets it
 * to 'pending' — an admin must re-verify before payouts resume. Editing
 * anything else, or editing while still in 'draft' (i.e. the wizard isn't
 * submitted yet), never changes approvalStatus — that only moves forward
 * via submitOrganizerProfileForReview below.
 */
export const upsertOrganizerProfile = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId)
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  const existing = user.organizerProfile
  const bankDetailsChanged =
    !!existing &&
    ((req.body.accountNumber && req.body.accountNumber !== existing.accountNumber) ||
      (req.body.bankCode && req.body.bankCode !== existing.bankCode))

  const nextApprovalStatus: IOrganizerProfile['approvalStatus'] =
    existing?.approvalStatus === 'approved' && bankDetailsChanged ? 'pending' : (existing?.approvalStatus ?? 'draft')

  const bankName = req.body.bankName ?? existing?.bankName
  const bankCode = req.body.bankCode ?? existing?.bankCode
  const accountNumber = req.body.accountNumber ?? existing?.accountNumber
  const accountName = req.body.accountName ?? existing?.accountName

  user.organizerProfile = {
    businessName: req.body.businessName ?? existing?.businessName,
    category: req.body.category ?? existing?.category,
    city: req.body.city ?? existing?.city,
    contactPhone: req.body.contactPhone ?? existing?.contactPhone,
    publicEmail: req.body.publicEmail ?? existing?.publicEmail,
    bio: req.body.bio ?? existing?.bio,
    bankName,
    bankCode,
    accountNumber,
    accountName,
    // "Ready" just means a fully resolved bank account is on file — this
    // drives the dashboard's "Finish setting up your account" banner
    // (see organizer/overview) independently of admin approval, since a
    // free-events-only organizer can be approved without ever adding one.
    isPayoutReady: !!(bankName && bankCode && accountNumber && accountName),
    approvalStatus: nextApprovalStatus,
    paystackRecipientCode: existing?.paystackRecipientCode,
    agreedToTerms: req.body.agreedToTerms ?? existing?.agreedToTerms ?? false,
    submittedAt: existing?.submittedAt,
  }

  await user.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Organizer profile updated',
    body: sanitizeUser(user.toObject()),
  })
})

const REQUIRED_FOR_SUBMISSION: { field: keyof IOrganizerProfile; label: string }[] = [
  { field: 'businessName', label: 'Organization name' },
  { field: 'category', label: 'Category' },
  { field: 'city', label: 'City' },
  { field: 'contactPhone', label: 'Contact phone' },
  { field: 'publicEmail', label: 'Public email' },
  { field: 'bio', label: 'Short bio' },
]

/**
 * Step 3 of the wizard ("Review & submit"). Bank details are deliberately
 * NOT required here — the Figma lets organizers skip that step and add it
 * later from settings; only free events need it to go live, per
 * event.controller.ts's paid-event gate.
 */
export const submitOrganizerProfileForReview = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId)
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  const profile = user.organizerProfile
  const missing = REQUIRED_FOR_SUBMISSION.filter(({ field }) => !profile?.[field]).map(({ label }) => label)
  if (missing.length > 0) {
    return sendTsRestError(res, 400, `Finish these before submitting: ${missing.join(', ')}`)
  }

  if (!req.body.agreedToTerms && !profile!.agreedToTerms) {
    return sendTsRestError(res, 400, 'You must agree to the Organizer Terms and Payout Policy')
  }

  user.role = 'organizer'
  user.organizerProfile!.agreedToTerms = true
  user.organizerProfile!.approvalStatus = 'pending'
  user.organizerProfile!.submittedAt = new Date()
  await user.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Submitted for review',
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

/** Powers the toggles on the organizer dashboard's Settings page. */
export const getOrganizerNotificationPreferences = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId).select('organizerNotificationPreferences').lean()
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Notification preferences fetched',
    body: user.organizerNotificationPreferences,
  })
})

export const updateOrganizerNotificationPreferences = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId)
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  user.organizerNotificationPreferences = { ...user.organizerNotificationPreferences, ...req.body }
  await user.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Notification preferences updated',
    body: user.organizerNotificationPreferences,
  })
})

// Paystack's bank list is effectively static — cache it in-process for a
// day instead of round-tripping to Paystack every time the bank dropdown
// renders. A restart just refetches once.
let bankListCache: { banks: { name: string; code: string }[]; fetchedAt: number } | null = null
const BANK_LIST_TTL_MS = 24 * 60 * 60 * 1000

export const listBanks = tryCatchWrapper(async (_req: Request, res: Response) => {
  if (!bankListCache || Date.now() - bankListCache.fetchedAt > BANK_LIST_TTL_MS) {
    const banks = await PaystackService.listBanks()
    bankListCache = { banks, fetchedAt: Date.now() }
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Banks fetched',
    body: bankListCache.banks,
  })
})

// Confirms the account holder's name for the "Where should we send your
// money?" step — the form fills Account Holder Name from this response
// rather than letting the organizer type it themselves, so we know the
// bank account genuinely belongs to whoever's claiming it.
export const resolveBankAccount = tryCatchWrapper(async (req: Request, res: Response) => {
  const { accountNumber, bankCode } = req.body

  try {
    const { accountName } = await PaystackService.resolveAccount({ accountNumber, bankCode })
    return sendTsRestSuccess(res, 200, {
      success: true,
      message: 'Account resolved',
      body: { accountName },
    })
  } catch (error: any) {
    return sendTsRestError(res, 400, error.message || 'Could not verify this account number')
  }
})

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  postponed: 'Postponed',
  sold_out: 'Sold out',
  live: 'Live',
  past: 'Past',
}

/**
 * Powers the dashboard's Overview page: the 4 stat cards (tickets sold,
 * revenue, live events, payout due) and the "Recent events" table.
 */
type RevenuePeriod = '7d' | '30d' | '1m'

/**
 * Powers the Revenue chart's period toggle. '7d'/'30d' are trailing daily
 * windows (7 or 30 points); '1m' is the current calendar month bucketed by
 * week instead — a deliberately different granularity, not just a third
 * date range, since 30 daily points and "this month" would otherwise show
 * near-identical shapes for most events.
 */
async function buildRevenueSeries(eventIds: mongoose.Types.ObjectId[], period: string): Promise<{ label: string; amount: number }[]> {
  const normalizedPeriod: RevenuePeriod = period === '7d' || period === '1m' ? period : '30d'
  const now = new Date()

  if (normalizedPeriod === '1m') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const orders = await Order.find({ event: { $in: eventIds }, status: 'paid', createdAt: { $gte: monthStart } })
      .select('organizerEarnings createdAt')
      .lean()

    const weekCount = Math.ceil((now.getDate() + new Date(now.getFullYear(), now.getMonth(), 1).getDay()) / 7)
    const buckets = Array.from({ length: weekCount }, (_, i) => ({ label: `W${i + 1}`, amount: 0 }))

    for (const order of orders) {
      const dayOfMonth = new Date(order.createdAt).getDate()
      const weekIndex = Math.min(Math.floor((dayOfMonth - 1) / 7), buckets.length - 1)
      buckets[weekIndex].amount += order.organizerEarnings
    }
    return buckets
  }

  const days = normalizedPeriod === '7d' ? 7 : 30
  const startDate = new Date(now)
  startDate.setDate(startDate.getDate() - (days - 1))
  startDate.setHours(0, 0, 0, 0)

  const orders = await Order.find({ event: { $in: eventIds }, status: 'paid', createdAt: { $gte: startDate } })
    .select('organizerEarnings createdAt')
    .lean()

  const buckets = new Map<string, number>()
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    buckets.set(d.toISOString().slice(0, 10), 0)
  }
  for (const order of orders) {
    const key = new Date(order.createdAt).toISOString().slice(0, 10)
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + order.organizerEarnings)
  }

  return Array.from(buckets.entries()).map(([date, amount]) => ({ label: date, amount }))
}

/**
 * "Tickets by type" donut — paid ticket tiers only (Regular/VIP/Table
 * etc). Free-event RSVPs have no ticketType to break down by, and mixing
 * them in would just add a meaningless "Free" wedge to what's meant to
 * show ticket-tier mix.
 */
async function buildTicketsByType(
  eventIds: mongoose.Types.ObjectId[]
): Promise<{ name: string; count: number; percentage: number }[]> {
  const rows = await Ticket.aggregate([
    { $match: { event: { $in: eventIds }, type: 'paid', status: { $ne: 'cancelled' } } },
    { $group: { _id: '$ticketType', count: { $sum: 1 } } },
    { $lookup: { from: 'ticket_types', localField: '_id', foreignField: '_id', as: 'ticketType' } },
    { $unwind: { path: '$ticketType', preserveNullAndEmptyArrays: true } },
    { $project: { name: { $ifNull: ['$ticketType.name', 'Other'] }, count: 1 } },
    { $sort: { count: -1 } },
  ])

  const total = rows.reduce((sum, row) => sum + row.count, 0)
  if (total === 0) return []

  return rows.map(row => ({ name: row.name, count: row.count, percentage: Math.round((row.count / total) * 100) }))
}

export const getOrganizerOverview = tryCatchWrapper(async (req: Request, res: Response) => {
  const events = await Event.find({ organizer: req.session.userId })
    .select('title slug coverImage type status startDate endDate capacity ticketsSoldCount reservationsCount revenueTotal category')
    .populate('category', 'name')
    .sort({ createdAt: -1 })
    .lean()

  let ticketsSold = 0
  let revenue = 0
  let liveCount = 0

  const recentEvents = events.slice(0, 6).map(event => {
    const soldCount = event.type === 'free' ? event.reservationsCount : event.ticketsSoldCount
    const displayStatus = deriveEventDisplayStatus(event)
    return {
      _id: event._id,
      title: event.title,
      slug: event.slug,
      coverImage: event.coverImage,
      category: (event.category as any)?.name,
      startDate: event.startDate,
      soldCount,
      capacity: event.capacity ?? null,
      status: displayStatus,
      statusLabel: STATUS_LABEL[displayStatus] ?? displayStatus,
    }
  })

  for (const event of events) {
    ticketsSold += event.ticketsSoldCount + event.reservationsCount
    revenue += event.revenueTotal
    if (deriveEventDisplayStatus(event) === 'live') liveCount += 1
  }

  const eventIds = events.map(event => event._id)
  const payoutFilter = { event: { $in: eventIds }, status: { $in: ['paid', 'partially_refunded'] } }

  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

  const [payoutTotals, nextPayoutOrder, periodTotals] = await Promise.all([
    Order.aggregate([{ $match: payoutFilter }, { $group: { _id: '$payoutStatus', amount: { $sum: '$organizerEarnings' } } }]),
    Order.findOne({ ...payoutFilter, payoutStatus: { $in: ['not_due', 'pending'] }, payoutAt: { $exists: true } })
      .sort({ payoutAt: 1 })
      .select('payoutAt')
      .lean(),
    // Powers "vs last month" on the tickets sold / revenue cards — two
    // real 30-day windows from paid orders, not a made-up figure.
    Order.aggregate([
      { $match: { event: { $in: eventIds }, status: 'paid', createdAt: { $gte: sixtyDaysAgo } } },
      {
        $group: {
          _id: { $cond: [{ $gte: ['$createdAt', thirtyDaysAgo] }, 'current', 'previous'] },
          tickets: { $sum: { $sum: '$items.quantity' } },
          revenue: { $sum: '$organizerEarnings' },
        },
      },
    ]),
  ])

  const totalsByStatus = payoutTotals.reduce((acc, t) => ({ ...acc, [t._id]: t.amount }), {} as Record<string, number>)
  const payoutDue = (totalsByStatus.pending ?? 0) + (totalsByStatus.processing ?? 0)

  let nextPayoutInDays: number | null = null
  if (nextPayoutOrder?.payoutAt) {
    const msRemaining = new Date(nextPayoutOrder.payoutAt).getTime() - Date.now()
    nextPayoutInDays = Math.max(Math.ceil(msRemaining / (24 * 60 * 60 * 1000)), 0)
  }

  const currentPeriod = periodTotals.find(p => p._id === 'current') ?? { tickets: 0, revenue: 0 }
  const previousPeriod = periodTotals.find(p => p._id === 'previous') ?? { tickets: 0, revenue: 0 }
  // null (not 0%) when there's no prior-period baseline to compare against
  // — "+100%" off a true zero is meaningless, so the client shows no
  // trend at all in that case rather than a misleading number.
  const percentChange = (current: number, previous: number): number | null =>
    previous > 0 ? Math.round(((current - previous) / previous) * 100) : null

  const revenueSeries = await buildRevenueSeries(eventIds, (req.query.period as string) ?? '30d')
  const ticketsByType = await buildTicketsByType(eventIds)

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Overview fetched',
    body: {
      ticketsSold,
      ticketsSoldChangePct: percentChange(currentPeriod.tickets, previousPeriod.tickets),
      revenue,
      revenueChangePct: percentChange(currentPeriod.revenue, previousPeriod.revenue),
      liveEventsCount: liveCount,
      payoutDue,
      nextPayoutInDays,
      recentEvents,
      revenueSeries,
      ticketsByType,
    },
  })
})

// Worse-to-better ordering — an event's row on the Payouts page shows the
// least-advanced status among its orders, since "Ready" would be
// misleading if even one order's earnings are still held.
const PAYOUT_STATUS_RANK: Record<string, number> = { not_due: 0, pending: 0, processing: 1, paid: 2 }
const EVENT_ROW_STATUS: Record<number, string> = { 0: 'held', 1: 'ready', 2: 'paid' }

/**
 * "Earning by event" table on the Payouts page — gross sales, the
 * platform's 5% commission, and what's actually owed to the organizer,
 * per event. Free events never generate an Order, so they're listed
 * separately with a 'free_no_payout' status rather than omitted.
 */
async function buildEarningsByEvent(organizerId: string) {
  const events = await Event.find({ organizer: organizerId })
    .select('title type')
    .sort({ createdAt: -1 })
    .lean()

  const rows = await Order.aggregate([
    { $match: { event: { $in: events.map(e => e._id) }, status: { $in: ['paid', 'partially_refunded'] } } },
    {
      $group: {
        _id: '$event',
        grossSales: { $sum: '$subtotal' },
        commission: { $sum: '$platformFee' },
        earnings: { $sum: '$organizerEarnings' },
        statuses: { $addToSet: '$payoutStatus' },
      },
    },
  ])

  const rowsByEvent = new Map(rows.map(r => [r._id.toString(), r]))

  return events
    .map(event => {
      const row = rowsByEvent.get(event._id.toString())
      if (!row) {
        // No paid orders for this event yet — either free, or nothing sold.
        return event.type === 'free'
          ? { eventId: event._id, eventTitle: event.title, grossSales: 0, commission: 0, earnings: 0, status: 'free_no_payout' }
          : null
      }
      const worstRank = Math.min(...row.statuses.map((s: string) => PAYOUT_STATUS_RANK[s] ?? 0))
      return {
        eventId: event._id,
        eventTitle: event.title,
        grossSales: row.grossSales,
        commission: row.commission,
        earnings: row.earnings,
        status: EVENT_ROW_STATUS[worstRank] ?? 'held',
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
}

/**
 * "Payout history" table — actual settled transfers. There's no separate
 * Payout/Transfer model, so this groups paid orders by the date they were
 * marked paid out (payoutAt) as a proxy for "one bank transfer batch that
 * day", which is how payouts are actually sent per the PRD (batched, not
 * per-order).
 */
async function buildPayoutHistory(organizerId: string) {
  const eventIds = await Event.find({ organizer: organizerId }).distinct('_id')

  const rows = await Order.aggregate([
    { $match: { event: { $in: eventIds }, payoutStatus: 'paid', payoutAt: { $exists: true } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$payoutAt' } },
        amount: { $sum: '$organizerEarnings' },
        payoutAt: { $first: '$payoutAt' },
      },
    },
    { $sort: { payoutAt: -1 } },
  ])

  return rows.map(row => ({ date: row.payoutAt, amount: row.amount }))
}

export const listOrganizerPayouts = tryCatchWrapper(async (req: Request, res: Response) => {
  const organizerId = req.session.userId!
  const user = await User.findById(req.session.userId).select('organizerProfile.bankName organizerProfile.accountNumber').lean()

  const [earningsByEvent, payoutHistory] = await Promise.all([
    buildEarningsByEvent(organizerId),
    buildPayoutHistory(organizerId),
  ])

  const bank = user?.organizerProfile
  const bankLabel =
    bank?.bankName && bank?.accountNumber ? `${bank.bankName} ....${bank.accountNumber.slice(-4)}` : null

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Payouts fetched',
    body: {
      earningsByEvent,
      payoutHistory: payoutHistory.map(row => ({ ...row, bankLabel, status: 'paid' })),
    },
  })
})
