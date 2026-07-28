import crypto from 'crypto'
import mongoose from 'mongoose'
import logger from '../config/logger.js'
import Event from '../models/event.js'
import { IOrder } from '../models/order.js'
import Ticket, { ITicket } from '../models/ticket.js'
import TicketType from '../models/ticketType.js'
import { IUser } from '../models/user.js'
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
   * Reserve a place at a free event. Capacity check + reservation increment
   * happen as a single atomic update so two concurrent requests can't both
   * squeeze past a nearly-full event (classic race condition).
   */
  static async rsvpToFreeEvent(eventId: string, user: IUser): Promise<ITicket> {
    const updatedEvent = await Event.findOneAndUpdate(
      {
        _id: eventId,
        type: 'free',
        status: 'approved',
        $or: [
          { capacity: { $exists: false } },
          { capacity: null },
          { $expr: { $lt: ['$reservationsCount', '$capacity'] } },
        ],
      },
      { $inc: { reservationsCount: 1 } },
      { new: true }
    )

    if (!updatedEvent) {
      // Either the event doesn't exist / isn't a live free event, or it's full.
      const existing = await Event.findById(eventId).lean()
      if (!existing || existing.type !== 'free' || existing.status !== 'approved') {
        throw new Error('This event is not open for reservations')
      }
      throw new Error('This event is fully booked')
    }

    try {
      const ticket = await Ticket.create({
        event: updatedEvent._id,
        attendee: user._id,
        code: this.generateTicketCode(),
        type: 'free',
        price: 0,
        attendeeName: user.fullname,
        attendeeEmail: user.email,
        status: 'valid',
      })

      EmailService.sendTicketConfirmationEmail({
        user,
        eventTitle: updatedEvent.title,
        eventDateLabel: formatEventDateLabel(updatedEvent.startDate),
        venueLabel: formatVenueLabel(updatedEvent.venue),
        ticketCodes: [ticket.code],
      }).catch(error => logger.error({ err: error }, `Ticket confirmation email failed for ticket ${ticket._id}`))

      return ticket
    } catch (error) {
      // Compensate the reservation count if ticket creation failed for any reason.
      await Event.updateOne({ _id: updatedEvent._id }, { $inc: { reservationsCount: -1 } })
      throw error
    }
  }

  /**
   * Issue tickets for a paid order once payment has been verified with Paystack.
   * Runs inside a transaction: ticket-type stock decrement, ticket creation, and
   * event/order totals must all succeed together or not at all.
   */
  static async issueTicketsForPaidOrder(order: IOrder, attendee: IUser): Promise<ITicket[]> {
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
            attendee: attendee._id,
            ticketType: item.ticketType,
            order: order._id,
            code: this.generateTicketCode(),
            type: 'paid' as const,
            price: item.unitPrice,
            attendeeName: attendee.fullname,
            attendeeEmail: attendee.email,
            status: 'valid' as const,
          }))

          const created = await Ticket.create(ticketsForItem, { session })
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
