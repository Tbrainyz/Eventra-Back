import mongoose, { Document, Schema } from 'mongoose'

export interface IOrderItem {
  ticketType: mongoose.Types.ObjectId
  quantity: number
  unitPrice: number
}

export interface IOrder extends Document {
  _id: mongoose.Types.ObjectId
  event: mongoose.Types.ObjectId
  buyer?: mongoose.Types.ObjectId
  // Set instead of `buyer` for a guest checkout (no account). Always one
  // or the other — enforced by the pre-validate hook below.
  guestName?: string
  guestEmail?: string
  guestPhone?: string
  items: IOrderItem[]
  subtotal: number
  platformFee: number
  organizerEarnings: number
  total: number
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded'
  paystackReference: string
  paidAt?: Date
  refundedAt?: Date
  refundAmount?: number
  payoutStatus: 'not_due' | 'pending' | 'processing' | 'paid'
  payoutAt?: Date
  createdAt: Date
  updatedAt: Date
}

const OrderItemSchema = new Schema<IOrderItem>(
  {
    ticketType: {
      type: Schema.Types.ObjectId,
      ref: 'TicketType',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
)


const OrderSchema = new Schema<IOrder>(
  {
    event: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },
    buyer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    guestName: {
      type: String,
      trim: true,
    },
    guestEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    guestPhone: {
      type: String,
      trim: true,
    },
    items: {
      type: [OrderItemSchema],
      required: true,
      validate: {
        validator: (items: IOrderItem[]) => items.length > 0,
        message: 'An order must contain at least one item',
      },
    },
    // Attendee pays exactly the ticket price(s) — the 5% commission is
    // deducted from the organizer's share, not added on top (see PRD worked example).
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    platformFee: {
      type: Number,
      required: true,
      min: 0,
    },
    organizerEarnings: {
      type: Number,
      required: true,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'],
      default: 'pending',
    },
    // Idempotency key for Paystack — prevents duplicate tickets/charges from retried webhooks.
    paystackReference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    paidAt: {
      type: Date,
    },
    refundedAt: {
      type: Date,
    },
    refundAmount: {
      type: Number,
      min: 0,
    },
    // Funds are held until a few days after the event, per the PRD.
    payoutStatus: {
      type: String,
      enum: ['not_due', 'pending', 'processing', 'paid'],
      default: 'not_due',
    },
    payoutAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
)

/**
 * Compute subtotal/platformFee/organizerEarnings/total from order items.
 * `commissionRatePercent` comes from the specific event being purchased
 * (Event.commissionRatePercent, snapshotted at event creation — see
 * lib/platformSettings.ts) rather than a fixed constant, so a platform-wide
 * rate change only ever applies to events created after that change.
 * Defaults to 5 for orders on events created before this field existed.
 */
export const calculateOrderTotals = (items: IOrderItem[], commissionRatePercent = 5) => {
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const platformFee = Math.round(subtotal * (commissionRatePercent / 100))
  const organizerEarnings = subtotal - platformFee
  return { subtotal, platformFee, organizerEarnings, total: subtotal }
}


OrderSchema.pre('validate', function (this: IOrder) {
  if (!this.buyer && !this.guestEmail) {
    throw new Error('Order must have either a buyer or guest contact details')
  }
})

OrderSchema.index({ buyer: 1, createdAt: -1 })
OrderSchema.index({ event: 1, status: 1 })
OrderSchema.index({ status: 1, payoutStatus: 1 })
// Powers guest order lookup (getOrderByReference has no buyer to filter by
// for a guest — reference + this index is enough for the checkout-callback
// polling case, and paystackReference already has its own unique index).
OrderSchema.index({ guestEmail: 1, createdAt: -1 })

const Order = mongoose.models.Order || mongoose.model<IOrder>('Order', OrderSchema, 'orders')

export default Order
