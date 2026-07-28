import mongoose, { Document, Schema } from 'mongoose'

export interface ITicket extends Document {
  _id: mongoose.Types.ObjectId
  event: mongoose.Types.ObjectId
  attendee: mongoose.Types.ObjectId
  ticketType?: mongoose.Types.ObjectId
  order?: mongoose.Types.ObjectId
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
    attendee: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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

const Ticket = mongoose.models.Ticket || mongoose.model<ITicket>('Ticket', TicketSchema, 'tickets')

export default Ticket
