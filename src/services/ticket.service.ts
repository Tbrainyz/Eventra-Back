import crypto from 'crypto'
import mongoose from 'mongoose'
import logger from '../config/logger.js'
import Event from '../models/event.js'
import { IOrder } from '../models/order.js'
import Ticket, { ITicket } from '../models/ticket.js'
import TicketType from '../models/ticketType.js'
import { AttendeeInfo } from '../lib/attendee.js'
import { EmailService } from './email.service.js'

const formatEventDateLabel = (date: Date): string =>
  date.toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' })

const formatVenueLabel = (venue: { name: string; city: string }): string => `${venue.name}, ${venue.city}`

export class TicketService {
  /**
   * Unguessable, unique QR payload. A screenshot of one ticket can never
   * pass as another because this value — not the ticket's _id — is what's scanned.
   */
  static generateTicketCode(): string {
    return `EVT-TKT-${crypto.randomBytes(16).toString('hex')}`
  }

  /**
   * Reserve 1-4 places at a free event in one action (the design calls this
   * "guests" — each guest still gets their own individual ticket/QR, this
   * just lets someone claim several in one request instead of repeating the
   * whole flow). Runs in a transaction: the capacity check + reservation
   * increment + every ticket document must all succeed together, same
   * reasoning as issueTicketsForPaidOrder below — partial success would
   * mean tickets that don't actually correspond to a held reservation.
   */
  static async rsvpToFreeEvent(eventId: string, attendee: AttendeeInfo, guests = 1): Promise<ITicket[]> {
    const session = await mongoose.startSession()
    let issuedTickets: ITicket[] = []
    let eventSnapshot: { _id: mongoose.Types.ObjectId; title: string; startDate: Date; venue: { name: string; city: string } } | null = null

    try {
      await session.withTransaction(async () => {
        const updatedEvent = await Event.findOneAndUpdate(
          {
            _id: eventId,
            type: 'free',
            status: 'approved',
            $or: [
              { capacity: { $exists: false } },
              { capacity: null },
              { $expr: { $lte: [{ $add: ['$reservationsCount', guests] }, '$capacity'] } },
            ],
          },
          { $inc: { reservationsCount: guests } },
          { new: true, session }
        )

        if (!updatedEvent) {
          const existing = await Event.findById(eventId).session(session).lean()
          if (!existing || existing.type !== 'free' || existing.status !== 'approved') {
            throw new Error('This event is not open for reservations')
          }
          const remaining = (existing.capacity ?? Infinity) - existing.reservationsCount
          throw new Error(
            remaining <= 0 ? 'This event is fully booked' : `Only ${remaining} spot(s) left — lower your guest count`
          )
        }

        eventSnapshot = updatedEvent

        issuedTickets = await Ticket.create(
          Array.from({ length: guests }, () => ({
            event: updatedEvent._id,
            attendee: attendee.userId,
            code: this.generateTicketCode(),
            type: 'free' as const,
            price: 0,
            attendeeName: attendee.fullname,
            attendeeEmail: attendee.email,
            status: 'valid' as const,
          })),
          { session, ordered: true }
        )
      })
    } finally {
      await session.endSession()
    }

    if (eventSnapshot) {
      const evt = eventSnapshot as { title: string; startDate: Date; venue: { name: string; city: string } }
      EmailService.sendTicketConfirmationEmail({
        user: attendee,
        eventTitle: evt.title,
        eventDateLabel: formatEventDateLabel(evt.startDate),
        venueLabel: formatVenueLabel(evt.venue),
        ticketCodes: issuedTickets.map(t => t.code),
      }).catch(error => logger.error({ err: error }, `Ticket confirmation email failed for RSVP on event ${eventId}`))
    }

    return issuedTickets
  }

  /**
   * Issue tickets for a paid order once payment has been verified with Paystack.
   * Runs inside a transaction: ticket-type stock decrement, ticket creation, and
   * event/order totals must all succeed together or not at all.
   */
  static async issueTicketsForPaidOrder(order: IOrder, attendee: AttendeeInfo): Promise<ITicket[]> {
    const session = await mongoose.startSession()
    let issuedTickets: ITicket[] = []

    try {
      await session.withTransaction(async () => {
        issuedTickets = []

        for (const item of order.items) {
          // Atomic guard: only decrement if enough stock remains — prevents
          // overselling a ticket type when two buyers check out at once.
          const updatedTicketType = await TicketType.findOneAndUpdate(
            {
              _id: item.ticketType,
              $expr: { $lte: [{ $add: ['$quantitySold', item.quantity] }, '$quantity'] },
            },
            { $inc: { quantitySold: item.quantity } },
            { new: true, session }
          )

          if (!updatedTicketType) {
            throw new Error('One or more ticket types sold out before payment was confirmed')
          }

          const ticketsForItem = Array.from({ length: item.quantity }).map(() => ({
            event: order.event,
            attendee: attendee.userId,
            ticketType: item.ticketType,
            order: order._id,
            code: this.generateTicketCode(),
            type: 'paid' as const,
            price: item.unitPrice,
            attendeeName: attendee.fullname,
            attendeeEmail: attendee.email,
            status: 'valid' as const,
          }))

          const created = await Ticket.create(ticketsForItem, { session, ordered: true })
          issuedTickets.push(...created)
        }

        const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0)

        await Event.updateOne(
          { _id: order.event },
          {
            $inc: {
              ticketsSoldCount: totalQuantity,
              revenueTotal: order.organizerEarnings,
            },
          },
          { session }
        )

        order.status = 'paid'
        order.paidAt = new Date()
        order.payoutStatus = 'pending'
        await order.save({ session })
      })

      const event = await Event.findById(order.event).lean()
      if (event) {
        EmailService.sendTicketConfirmationEmail({
          user: attendee,
          eventTitle: event.title,
          eventDateLabel: formatEventDateLabel(event.startDate),
          venueLabel: formatVenueLabel(event.venue),
          ticketCodes: issuedTickets.map(t => t.code),
        }).catch(error => logger.error({ err: error }, `Ticket confirmation email failed for order ${order._id}`))
      }

      return issuedTickets
    } finally {
      await session.endSession()
    }
  }
}

export const ticketService = new TicketService()
