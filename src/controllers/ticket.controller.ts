import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import Event from '../models/event.js'
import Order, { calculateOrderTotals } from '../models/order.js'
import RefundRequest from '../models/refundRequest.js'
import Ticket from '../models/ticket.js'
import TicketType from '../models/ticketType.js'
import User from '../models/user.js'
import { PaystackService } from '../services/paystack.service.js'
import { TicketService } from '../services/ticket.service.js'
import { env } from '../config/keys.js'
import { generateQrCodeDataUrl } from '../lib/qrcode.js'
import { checkRefundEligibility } from '../lib/refundPolicy.js'
import { buildPaginationMeta, getPagination } from '../lib/utils.js'

const NAIRA_TO_KOBO = 100

export const rsvpFreeEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { eventId } = req.params

  const user = await User.findById(req.session.userId)
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  try {
    const ticket = await TicketService.rsvpToFreeEvent(eventId as string, user)
    return sendTsRestSuccess(res, 201, {
      success: true,
      message: 'Reservation confirmed',
      body: ticket.toObject(),
    })
  } catch (error: any) {
    return sendTsRestError(res, 400, error.message || 'Could not complete reservation')
  }
})

export const initializeCheckout = tryCatchWrapper(async (req: Request, res: Response) => {
  const { eventId } = req.params
  const { items } = req.body as { items: { ticketTypeId: string; quantity: number }[] }

  const [event, user] = await Promise.all([Event.findById(eventId), User.findById(req.session.userId)])

  if (!event || event.type !== 'paid' || event.status !== 'approved') {
    return sendTsRestError(res, 404, 'This event is not open for ticket purchases')
  }
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  const ticketTypeIds = items.map(item => item.ticketTypeId)
  const ticketTypes = await TicketType.find({ _id: { $in: ticketTypeIds }, event: event._id, isActive: true })

  if (ticketTypes.length !== ticketTypeIds.length) {
    return sendTsRestError(res, 400, 'One or more ticket types are invalid for this event')
  }

  const orderItems: { ticketType: any; quantity: number; unitPrice: number }[] = []

  for (const item of items) {
    const ticketType = ticketTypes.find(tt => tt._id.toString() === item.ticketTypeId)!
    const remaining = ticketType.quantity - ticketType.quantitySold

    if (item.quantity > ticketType.purchaseLimitPerPerson) {
      return sendTsRestError(res, 400, `You can buy at most ${ticketType.purchaseLimitPerPerson} "${ticketType.name}" tickets`)
    }
    if (item.quantity > remaining) {
      return sendTsRestError(res, 400, `Only ${remaining} "${ticketType.name}" tickets remain`)
    }

    orderItems.push({ ticketType: ticketType._id, quantity: item.quantity, unitPrice: ticketType.price })
  }

  const totals = calculateOrderTotals(orderItems)
  const reference = `EVT-${event._id.toString().slice(-6)}-${randomUUID()}`

  const order = await Order.create({
    event: event._id,
    buyer: user._id,
    items: orderItems,
    ...totals,
    status: 'pending',
    paystackReference: reference,
  })

  try {
    const paystackTx = await PaystackService.initializeTransaction({
      email: user.email,
      amountKobo: Math.round(totals.total * NAIRA_TO_KOBO),
      reference,
      callbackUrl: `${env.CLIENT_URL}/checkout/callback`,
      metadata: { orderId: order._id.toString(), eventId: event._id.toString() },
    })

    return sendTsRestSuccess(res, 201, {
      success: true,
      message: 'Checkout initialized',
      body: {
        orderId: order._id,
        reference,
        authorizationUrl: paystackTx.authorizationUrl,
        total: totals.total,
      },
    })
  } catch (error: any) {
    order.status = 'failed'
    await order.save()
    return sendTsRestError(res, 502, error.message || 'Could not start payment with Paystack')
  }
})

/**
 * An attendee cancels their own free-event reservation, releasing the place.
 * No payment is involved for free events, so this is a straight cancellation.
 */
export const cancelReservation = tryCatchWrapper(async (req: Request, res: Response) => {
  const { ticketId } = req.params

  const ticket = await Ticket.findOne({ _id: ticketId, attendee: req.session.userId, type: 'free' })
  if (!ticket) {
    return sendTsRestError(res, 404, 'Reservation not found')
  }
  if (ticket.status !== 'valid') {
    return sendTsRestError(res, 400, 'This reservation can no longer be cancelled')
  }

  ticket.status = 'cancelled'
  await ticket.save()
  await Event.updateOne({ _id: ticket.event }, { $inc: { reservationsCount: -1 } })

  return sendTsRestSuccess<undefined>(res, 200, {
    success: true,
    message: 'Reservation cancelled',
  })
})

/**
 * An attendee requests a refund for a paid ticket. Subject to the event's
 * refund policy — except a postponed event, where a refund can always be requested.
 */
export const requestRefund = tryCatchWrapper(async (req: Request, res: Response) => {
  const { ticketId } = req.params
  const { reason } = req.body as { reason?: string }

  const ticket = await Ticket.findOne({ _id: ticketId, attendee: req.session.userId, type: 'paid' })
  if (!ticket) {
    return sendTsRestError(res, 404, 'Ticket not found')
  }
  if (ticket.status !== 'valid' && ticket.status !== 'checked_in') {
    return sendTsRestError(res, 400, 'This ticket is not eligible for a refund')
  }

  const event = await Event.findById(ticket.event)
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }

  const eligibility = checkRefundEligibility(event.status, event.refundPolicy, event.startDate)
  if (!eligibility.allowed) {
    return sendTsRestError(res, 400, eligibility.reason ?? 'This ticket is not eligible for a refund')
  }

  const existingRequest = await RefundRequest.findOne({ ticket: ticket._id, status: { $in: ['pending', 'approved'] } })
  if (existingRequest) {
    return sendTsRestError(res, 409, 'A refund request is already in progress for this ticket')
  }

  const refundRequest = await RefundRequest.create({
    ticket: ticket._id,
    order: ticket.order,
    event: ticket.event,
    requestedBy: req.session.userId,
    reason,
    amount: ticket.price,
  })

  return sendTsRestSuccess(res, 201, {
    success: true,
    message: 'Refund request submitted for admin review',
    body: refundRequest.toObject(),
  })
})

export const myTickets = tryCatchWrapper(async (req: Request, res: Response) => {
  const tickets = await Ticket.find({ attendee: req.session.userId })
    .populate('event', 'title slug startDate venue coverImage')
    .sort({ createdAt: -1 })
    .lean()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Tickets fetched',
    body: tickets,
  })
})

export const getTicketQrCode = tryCatchWrapper(async (req: Request, res: Response) => {
  const { ticketId } = req.params

  const ticket = await Ticket.findOne({ _id: ticketId, attendee: req.session.userId }).lean()
  if (!ticket) {
    return sendTsRestError(res, 404, 'Ticket not found')
  }

  const qrCodeDataUrl = await generateQrCodeDataUrl(ticket.code)

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'QR code generated',
    body: { qrCodeDataUrl },
  })
})

/**
 * Scan a ticket's QR code at the door. Always returns one of three clear
 * results — valid / already_used / invalid — matching the PRD's
 * green-Valid / red-Already-used-or-Not-valid scanner UI.
 * The atomic status flip at the end makes repeated/offline-queued scans of
 * the same code safe to replay once connectivity returns.
 */
export const checkInTicket = tryCatchWrapper(async (req: Request, res: Response) => {
  const { eventId } = req.params
  const { code } = req.body as { code: string }

  const event = await Event.findOne({ _id: eventId, organizer: req.session.userId })
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }

  const ticket = await Ticket.findOne({ code })

  if (!ticket || ticket.event.toString() !== event._id.toString()) {
    return sendTsRestSuccess(res, 200, {
      success: true,
      message: 'Not valid',
      body: { result: 'invalid' },
    })
  }

  if (ticket.status !== 'valid') {
    return sendTsRestSuccess(res, 200, {
      success: true,
      message: ticket.status === 'checked_in' ? 'Already checked in' : `Ticket is ${ticket.status}`,
      body: { result: 'already_used', checkedInAt: ticket.checkedInAt ?? null },
    })
  }

  // Atomic guard: if two scans race, only one flips valid → checked_in.
  const updated = await Ticket.findOneAndUpdate(
    { _id: ticket._id, status: 'valid' },
    { $set: { status: 'checked_in', checkedInAt: new Date(), checkedInBy: req.session.userId } },
    { new: true }
  )

  if (!updated) {
    return sendTsRestSuccess(res, 200, {
      success: true,
      message: 'Already checked in',
      body: { result: 'already_used' },
    })
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Valid',
    body: { result: 'valid', ticket: updated.toObject() },
  })
})

export const listEventAttendees = tryCatchWrapper(async (req: Request, res: Response) => {
  const { eventId } = req.params
  const event = await Event.findOne({ _id: eventId, organizer: req.session.userId })
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }

  if (req.query.format === 'csv') {
    // Full export — never paginated, the organizer needs every row.
    const tickets = await Ticket.find({ event: event._id }).populate('ticketType', 'name').sort({ createdAt: -1 }).lean()

    const header = 'name,email,ticket_type,price,status,checked_in_at\n'
    const rows = tickets
      .map(t => {
        const ticketTypeName = (t.ticketType as any)?.name ?? 'Free RSVP'
        return [t.attendeeName, t.attendeeEmail, ticketTypeName, t.price, t.status, t.checkedInAt ?? '']
          .map(value => `"${String(value).replace(/"/g, '""')}"`)
          .join(',')
      })
      .join('\n')

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="${event.slug}-attendees.csv"`)
    res.status(200).send(header + rows)
    return
  }

  const { page, limit, skip } = getPagination(req.query)
  const filter = { event: event._id }

  const [tickets, total] = await Promise.all([
    Ticket.find(filter).populate('ticketType', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Ticket.countDocuments(filter),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Attendees fetched',
    body: { tickets, meta: buildPaginationMeta(page, limit, total) },
  })
})
