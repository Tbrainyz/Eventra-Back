import mongoose, { Document, Schema } from 'mongoose'

export interface ITicket extends Document {
  _id: mongoose.Types.ObjectId
  event: mongoose.Types.ObjectId
  attendee?: mongoose.Types.ObjectId
  ticketType?: mongoose.Types.ObjectId
  order?: mongoose.Types.ObjectId
  // Human-readable ticket identifier shown to attendees/organizers (e.g.
  // "TKT-A1B2C3D4") — the Mongo `_id` is an internal implementation detail
  // and was never meant to be a user-facing ticket number.
  ticketId: string
  code: string
  type: 'free' | 'paid'
  price: number
  attendeeName: string
  attendeeEmail: string
  status: 'valid' | 'checked_in' | 'cancelled' | 'refunded'
  checkedInAt?: Date
  checkedInBy?: mongoose.Types.ObjectId
  cancelledAt?: Date
  issuedAt: Date
  createdAt: Date
  updatedAt: Date
}

const TicketSchema = new Schema<ITicket>(
  {
    event: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },
    // Absent for a guest ticket (bought/reserved without an account) — see
    // resolveAttendeeInfo in lib/attendee.ts. attendeeName/attendeeEmail
    // below are always set regardless, so a guest ticket is fully usable
    // without this field.
    attendee: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    // Absent for free-event reservations (no ticket types on free events).
    ticketType: {
      type: Schema.Types.ObjectId,
      ref: 'TicketType',
    },
    // Absent for free-event reservations (no payment involved).
    order: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
    },
    // Short, human-readable identifier — displayed on the ticket card and
    // to organizers. Not a secret (unlike `code` below), just a friendlier
    // stand-in for the Mongo `_id`.
    ticketId: {
      type: String,
      required: true,
      unique: true,
    },
    // The value encoded in the QR code. Must be unguessable and unique per ticket
    // so a screenshot of one ticket can never be reused as another.
    code: {
      type: String,
      required: true,
      unique: true,
    },
    type: {
      type: String,
      enum: ['free', 'paid'],
      required: true,
    },
    price: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Snapshot of attendee details at issue time, so the organizer's exported
    // attendee list stays accurate even if the attendee later edits their profile.
    attendeeName: {
      type: String,
      required: true,
      trim: true,
    },
    attendeeEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    status: {
      type: String,
      enum: ['valid', 'checked_in', 'cancelled', 'refunded'],
      default: 'valid',
    },
    checkedInAt: {
      type: Date,
    },
    checkedInBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    cancelledAt: {
      type: Date,
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
)

// Indexes — support attendee lists/export, check-in scanning, and My Tickets
TicketSchema.index({ event: 1, status: 1 })
TicketSchema.index({ attendee: 1, createdAt: -1 })
TicketSchema.index({ order: 1 })
// Powers guest ticket lookup (no `attendee` to query by) — see
// listGuestTickets in ticket.controller.ts.
TicketSchema.index({ attendeeEmail: 1, createdAt: -1 })

const Ticket = mongoose.models.Ticket || mongoose.model<ITicket>('Ticket', TicketSchema, 'tickets')

export default Ticket
