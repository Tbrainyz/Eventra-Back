import crypto from 'crypto'
import { Request, Response } from 'express'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import { buildPaginationMeta, escapeRegExp, getDateRangeForWhen, getPagination, isValidObjectId, slugify } from '../lib/utils.js'
import Category from '../models/category.js'
import Event from '../models/event.js'
import Order from '../models/order.js'
import Ticket from '../models/ticket.js'
import TicketType from '../models/ticketType.js'
import User from '../models/user.js'
import { PaystackService } from '../services/paystack.service.js'

const EDITABLE_STATUSES = ['draft', 'rejected']

export const createEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { category: categoryId, ...rest } = req.body

  const category = await Category.findOne({ _id: categoryId, isActive: true })
  if (!category) {
    return sendTsRestError(res, 400, 'Invalid or inactive category')
  }

  const slug = `${slugify(rest.title)}-${crypto.randomBytes(3).toString('hex')}`

  const event = await Event.create({
    ...rest,
    category: category._id,
    slug,
    organizer: req.session.userId,
    status: 'draft',
  })

  return sendTsRestSuccess(res, 201, {
    success: true,
    message: 'Event created as a draft',
    body: event.toObject(),
  })
})

export const updateEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, organizer: req.session.userId })

  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (!EDITABLE_STATUSES.includes(event.status)) {
    return sendTsRestError(res, 400, 'Only draft or rejected events can be edited')
  }

  const { category: categoryId, ...rest } = req.body

  if (categoryId) {
    const category = await Category.findOne({ _id: categoryId, isActive: true })
    if (!category) {
      return sendTsRestError(res, 400, 'Invalid or inactive category')
    }
    event.category = category._id
  }

  Object.assign(event, rest)
  await event.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event updated',
    body: event.toObject(),
  })
})

export const submitEventForApproval = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, organizer: req.session.userId })

  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (!EDITABLE_STATUSES.includes(event.status)) {
    return sendTsRestError(res, 400, 'This event has already been submitted')
  }

  const organizer = await User.findById(req.session.userId)
  if (!organizer || organizer.organizerProfile?.approvalStatus !== 'approved') {
    return sendTsRestError(res, 403, 'Your organizer account must be approved before publishing events')
  }

  if (event.type === 'paid') {
    const hasBankDetails = organizer.organizerProfile?.accountNumber && organizer.organizerProfile?.bankCode
    if (!hasBankDetails) {
      return sendTsRestError(res, 400, 'Add your bank account details before publishing a paid event')
    }
    const ticketTypeCount = await TicketType.countDocuments({ event: event._id })
    if (ticketTypeCount === 0) {
      return sendTsRestError(res, 400, 'Add at least one ticket type before submitting a paid event')
    }
  }

  event.status = 'pending_approval'
  event.rejectionReason = undefined
  await event.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event submitted for admin approval',
    body: event.toObject(),
  })
})

export const deleteEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, organizer: req.session.userId })

  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (!EDITABLE_STATUSES.includes(event.status) || event.reservationsCount > 0 || event.ticketsSoldCount > 0) {
    return sendTsRestError(res, 400, 'Only draft or rejected events with no reservations/sales can be deleted')
  }

  await TicketType.deleteMany({ event: event._id })
  await event.deleteOne()

  return sendTsRestSuccess<undefined>(res, 200, {
    success: true,
    message: 'Event deleted',
  })
})

export const listMyEvents = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)
  const filter = { organizer: req.session.userId }

  const [events, total] = await Promise.all([
    Event.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Event.countDocuments(filter),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Your events fetched',
    body: { events, meta: buildPaginationMeta(page, limit, total) },
  })
})

// Public — only ever surfaces admin-approved events.
export const listPublicEvents = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)

  const filter: Record<string, any> = { status: 'approved' }

  // Category — accepts a single id or a comma-separated list, e.g. ?category=a,b,c
  if (req.query.category && typeof req.query.category === 'string') {
    const categoryIds = req.query.category.split(',').map(id => id.trim()).filter(isValidObjectId)
    if (categoryIds.length === 1) filter.category = categoryIds[0]
    else if (categoryIds.length > 1) filter.category = { $in: categoryIds }
  }

  if (req.query.city && typeof req.query.city === 'string') {
    filter['venue.city'] = new RegExp(escapeRegExp(req.query.city), 'i')
  }
  if (req.query.type === 'free' || req.query.type === 'paid') filter.type = req.query.type

  // "When" — Today / This weekend / This week / This month
  if (
    req.query.when === 'today' ||
    req.query.when === 'this-weekend' ||
    req.query.when === 'this-week' ||
    req.query.when === 'this-month'
  ) {
    const { from, to } = getDateRangeForWhen(req.query.when)
    filter.startDate = { $gte: from, $lte: to }
  }

  // Price — filters on the denormalized Event.minPrice (see models/event.ts)
  const minPrice = Number(req.query.minPrice)
  const maxPrice = Number(req.query.maxPrice)
  if (!Number.isNaN(minPrice) || !Number.isNaN(maxPrice)) {
    filter.minPrice = {}
    if (!Number.isNaN(minPrice)) filter.minPrice.$gte = minPrice
    if (!Number.isNaN(maxPrice)) filter.minPrice.$lte = maxPrice
  }

  const searchQuery = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : null
  if (searchQuery) {
    filter.$text = { $search: searchQuery }
  }

  const projection = searchQuery ? { score: { $meta: 'textScore' } } : undefined

  // A search term always takes priority for ordering. Otherwise, `sort` picks
  // the order; default ("trending") is featured-first then soonest.
  let sort: Record<string, any> = { isPromoted: -1, startDate: 1 }
  if (searchQuery) {
    sort = { score: { $meta: 'textScore' } }
  } else if (req.query.sort === 'date') {
    sort = { startDate: 1 }
  } else if (req.query.sort === 'price-asc') {
    sort = { minPrice: 1 }
  } else if (req.query.sort === 'price-desc') {
    sort = { minPrice: -1 }
  }

  const [events, total] = await Promise.all([
    Event.find(filter, projection)
      .sort(sort as any)
      .skip(skip)
      .limit(limit)
      .populate('category', 'name slug')
      .lean(),
    Event.countDocuments(filter),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Events fetched',
    body: { events, meta: buildPaginationMeta(page, limit, total) },
  })
})

export const getEventDashboard = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, organizer: req.session.userId }).lean()
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }

  const ticketTypes =
    event.type === 'paid'
      ? await TicketType.find({ event: event._id })
          .select('name price quantity quantitySold purchaseLimitPerPerson isActive')
          .lean()
      : []

  const body = {
    event: {
      _id: event._id,
      title: event.title,
      status: event.status,
      type: event.type,
      startDate: event.startDate,
    },
    reservationsCount: event.reservationsCount,
    capacity: event.capacity ?? null,
    capacityRemaining: event.capacity ? Math.max(event.capacity - event.reservationsCount, 0) : null,
    ticketsSoldCount: event.ticketsSoldCount,
    revenueTotal: event.revenueTotal,
    ticketTypes: ticketTypes.map(tt => ({
      ...tt,
      quantityRemaining: Math.max(tt.quantity - tt.quantitySold, 0),
    })),
    payout: {
      // Funds are held until a few days after the event — see PAYOUT_DELAY_DAYS in ticket.service.ts
      amountDue: event.revenueTotal,
    },
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Dashboard fetched',
    body,
  })
})

/**
 * Cancels a live event. Paid tickets are refunded (one Paystack refund per
 * order) and all tickets invalidated. Free reservations are simply invalidated.
 */
export const cancelEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const isAdmin = req.session.role === 'admin'

  const event = await Event.findOne(isAdmin ? { _id: id } : { _id: id, organizer: req.session.userId })
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (event.status !== 'approved' && event.status !== 'postponed') {
    return sendTsRestError(res, 400, 'Only a live (approved or postponed) event can be cancelled')
  }

  event.status = 'cancelled'
  event.cancelledAt = new Date()
  await event.save()

  if (event.type === 'paid') {
    const paidOrders = await Order.find({ event: event._id, status: 'paid' })
    for (const order of paidOrders) {
      try {
        await PaystackService.refundTransaction({
          transactionReference: order.paystackReference,
          reason: 'Event cancelled by organizer',
        })
        order.status = 'refunded'
        order.refundedAt = new Date()
        order.refundAmount = order.total
        await order.save()
        await Ticket.updateMany({ order: order._id, status: { $in: ['valid', 'checked_in'] } }, { status: 'refunded' })
      } catch (error: any) {
        // Logged inside PaystackService — leave this order for manual admin follow-up.
      }
    }
  } else {
    await Ticket.updateMany({ event: event._id, status: 'valid' }, { status: 'cancelled' })
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event cancelled. Paid attendees are being refunded',
    body: event.toObject(),
  })
})

/**
 * Postpones a live event to a new date. Existing tickets stay valid; attendees
 * who can't make the new date use the normal refund-request flow.
 */
export const postponeEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const { newStartDate } = req.body
  const isAdmin = req.session.role === 'admin'

  if (!newStartDate) {
    return sendTsRestError(res, 400, 'newStartDate is required')
  }

  const event = await Event.findOne(isAdmin ? { _id: id } : { _id: id, organizer: req.session.userId })
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (event.status !== 'approved') {
    return sendTsRestError(res, 400, 'Only a live approved event can be postponed')
  }

  event.status = 'postponed'
  event.postponedTo = new Date(newStartDate)
  await event.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event postponed. Existing tickets remain valid',
    body: event.toObject(),
  })
})

export const getEventBySlug = tryCatchWrapper(async (req: Request, res: Response) => {
  const { slug } = req.params

  const event = await Event.findOne({ slug, status: 'approved' })
    .populate('category', 'name slug')
    .populate('organizer', 'fullname organizerProfile.businessName')
    .lean()

  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }

  const ticketTypes =
    event.type === 'paid' ? await TicketType.find({ event: event._id, isActive: true }).lean() : []

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event fetched',
    body: { ...event, ticketTypes },
  })
})
