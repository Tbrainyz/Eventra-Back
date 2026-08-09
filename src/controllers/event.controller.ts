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

  // Only validated when provided — the wizard creates the draft right
  // after Step 1 (Type only), well before Step 2 collects a category.
  let category = null
  if (categoryId) {
    category = await Category.findOne({ _id: categoryId, isActive: true })
    if (!category) {
      return sendTsRestError(res, 400, 'Invalid or inactive category')
    }
  }

  // Untitled drafts still need a unique slug to satisfy the schema — this
  // gets replaced with a proper title-based one the moment a title is set
  // (see updateEvent below), so it's never the slug a published event
  // actually ends up with.
  const slug = `${rest.title ? slugify(rest.title) : 'untitled-event'}-${crypto.randomBytes(3).toString('hex')}`

  const event = await Event.create({
    ...rest,
    ...(category ? { category: category._id } : {}),
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

  // Only while still 'draft' — a rejected event being fixed already has a
  // slug that may have been shared/seen, so editing it further shouldn't
  // change the URL out from under anyone.
  if (rest.title && event.status === 'draft') {
    event.slug = `${slugify(rest.title)}-${crypto.randomBytes(3).toString('hex')}`
  }

  await event.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event updated',
    body: event.toObject(),
  })
})

/**
 * Separate from updateEvent on purpose — that endpoint is locked to
 * draft/rejected events because changing venue, date, price, or capacity
 * on a live event is exactly the kind of thing that should require
 * re-approval. Lineup isn't that: "DJ X just confirmed" is routine on an
 * event that's already approved and selling tickets, so this only blocks
 * cancelled events, not approved/pending/postponed ones.
 */
export const updateEventLineup = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, organizer: req.session.userId })

  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (event.status === 'cancelled') {
    return sendTsRestError(res, 400, "Can't edit the lineup of a cancelled event")
  }

  event.lineup = req.body.lineup
  await event.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Lineup updated',
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

  // Every field the wizard collects across its steps used to be required
  // by the Zod schema at creation time — now that a draft can be created
  // with just `type` (see createEventSchema), completeness is enforced
  // here instead, at the point it actually needs to be true.
  const missing: string[] = []
  if (!event.title) missing.push('Event name')
  if (!event.description) missing.push('Description')
  if (!event.category) missing.push('Category')
  if (!event.startDate) missing.push('Date & time')
  if (event.isOnline ? !event.onlineJoinLink : !event.venue) missing.push(event.isOnline ? 'Join link' : 'Venue')
  if (missing.length > 0) {
    return sendTsRestError(res, 400, `Finish these before submitting: ${missing.join(', ')}`)
  }

  const organizer = await User.findById(req.session.userId)
  if (!organizer) {
    return sendTsRestError(res, 404, 'Organizer not found')
  }

  if (event.type === 'paid') {
    if (organizer.organizerProfile?.approvalStatus !== 'approved') {
      return sendTsRestError(res, 403, 'Your organizer account must be approved before publishing a paid event')
    }
    const hasBankDetails = organizer.organizerProfile?.accountNumber && organizer.organizerProfile?.bankCode
    if (!hasBankDetails) {
      return sendTsRestError(res, 400, 'Add your bank account details before publishing a paid event')
    }
    const ticketTypeCount = await TicketType.countDocuments({ event: event._id })
    if (ticketTypeCount === 0) {
      return sendTsRestError(res, 400, 'Add at least one ticket type before submitting a paid event')
    }

    event.status = 'pending_approval'
    event.rejectionReason = undefined
    await event.save()

    return sendTsRestSuccess(res, 200, {
      success: true,
      message: 'Event submitted for admin approval',
      body: event.toObject(),
    })
  }

  // Free events skip organizer-approval and admin review entirely — "Free
  // events can go live now, paid events unlock once you're verified" is
  // the actual promise made on the dashboard banner, so this has to be
  // true regardless of the organizer's own approvalStatus.
  event.status = 'approved'
  event.rejectionReason = undefined
  event.publishedAt = new Date()
  await event.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Your event is live',
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

/**
 * Clones an event (and its ticket types) into a fresh draft — the fast
 * path for "run this again next month" without re-filling the whole
 * wizard. Deliberately resets everything that shouldn't carry over:
 * status/dates/sales counters/promotion/lineup images stay put, but the
 * new copy starts from zero, unpublished, with its own slug.
 */
export const duplicateEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const source = await Event.findOne({ _id: id, organizer: req.session.userId }).lean()

  if (!source) {
    return sendTsRestError(res, 404, 'Event not found')
  }

  const title = source.title ? `${source.title} (Copy)` : undefined

  const duplicate = await Event.create({
    organizer: req.session.userId,
    title,
    slug: `${title ? slugify(title) : 'untitled-event'}-${crypto.randomBytes(3).toString('hex')}`,
    description: source.description,
    category: source.category,
    type: source.type,
    coverImage: source.coverImage,
    venue: source.venue,
    isOnline: source.isOnline,
    onlinePlatform: source.onlinePlatform,
    onlineJoinLink: source.onlineJoinLink,
    capacity: source.capacity,
    refundPolicy: source.refundPolicy,
    lineup: source.lineup,
    gallery: source.gallery,
    agePolicy: source.agePolicy,
    // Explicitly NOT carried over: startDate/endDate (last run's dates
    // rarely apply to the next one), status (always starts a fresh
    // draft), isPromoted/promotion, and every sales/reservation counter.
  })

  const sourceTicketTypes = await TicketType.find({ event: source._id }).lean()
  if (sourceTicketTypes.length > 0) {
    await TicketType.insertMany(
      sourceTicketTypes.map(ticketType => ({
        event: duplicate._id,
        name: ticketType.name,
        description: ticketType.description,
        price: ticketType.price,
        quantity: ticketType.quantity,
        purchaseLimitPerPerson: ticketType.purchaseLimitPerPerson,
        isActive: ticketType.isActive,
        // quantitySold intentionally omitted — defaults to 0, this is a
        // brand-new, unsold batch of tickets.
      }))
    )

    // Mirrors syncEventMinPrice in ticketType.controller.ts — insertMany
    // bypasses that controller entirely, so Event.minPrice needs the same
    // recompute done here instead of drifting from what was just inserted.
    const cheapest = await TicketType.findOne({ event: duplicate._id, isActive: true }).sort({ price: 1 }).select('price').lean()
    duplicate.minPrice = cheapest?.price ?? 0
    await duplicate.save()
  }

  return sendTsRestSuccess(res, 201, {
    success: true,
    message: 'Event duplicated as a new draft',
    body: duplicate.toObject(),
  })
})

export const listMyEvents = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)
  const filter = { organizer: req.session.userId }

  const [events, total] = await Promise.all([
    Event.find(filter).populate('category', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
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
  const event = await Event.findOne({ _id: id, organizer: req.session.userId }).populate('category', 'name').lean()
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }

  const [ticketTypes, checkedInCount, recentAttendees] = await Promise.all([
    event.type === 'paid'
      ? TicketType.find({ event: event._id }).select('name price quantity quantitySold purchaseLimitPerPerson isActive').lean()
      : Promise.resolve([]),
    Ticket.countDocuments({ event: event._id, status: 'checked_in' }),
    Ticket.find({ event: event._id })
      .select('attendeeName code type status ticketType')
      .populate('ticketType', 'name')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ])

  const body = {
    event: {
      _id: event._id,
      title: event.title,
      slug: event.slug,
      description: event.description,
      status: event.status,
      type: event.type,
      category: (event.category as any)?.name,
      coverImage: event.coverImage,
      startDate: event.startDate,
      isOnline: event.isOnline,
      venue: event.venue,
      lineup: event.lineup,
      isPromoted: event.isPromoted,
      promotionStatus: event.promotion?.status,
    },
    reservationsCount: event.reservationsCount,
    capacity: event.capacity ?? null,
    capacityRemaining: event.capacity ? Math.max(event.capacity - event.reservationsCount, 0) : null,
    ticketsSoldCount: event.ticketsSoldCount,
    revenueTotal: event.revenueTotal,
    checkedInCount,
    recentAttendees: recentAttendees.map(t => ({
      _id: t._id,
      attendeeName: t.attendeeName,
      code: t.code,
      status: t.status,
      ticketTypeName: t.type === 'free' ? 'RSVP' : ((t.ticketType as any)?.name ?? 'General'),
    })),
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
 * Fetches the raw, full-fidelity event document (every field, no computed
 * stats) — used by the create/edit wizard to resume a draft. Deliberately
 * separate from getEventDashboard above: that endpoint returns a
 * stats-shaped view for the event-detail page, not a form-fillable one.
 */
export const getMyEventById = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, organizer: req.session.userId }).lean()
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event fetched',
    body: event,
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
