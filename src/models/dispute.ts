import mongoose, { Document, Schema } from 'mongoose'

/**
 * A Paystack chargeback/fraud dispute against one of our orders. Rows are
 * created from the `charge.dispute.create` webhook (see
 * payment.controller.ts's paystackWebhook) — never created by an admin
 * action, only acted on by one (Challenge / Accept loss, both in
 * admin.controller.ts, both calling PaystackService).
 */
export interface IDispute extends Document {
  _id: mongoose.Types.ObjectId
  paystackDisputeId: string
  order: mongoose.Types.ObjectId
  event: mongoose.Types.ObjectId
  amount: number
  // Mirrors Paystack's own dispute status values (awaiting-merchant-feedback
  // | awaiting-bank-feedback | pending | resolved) plus our two local
  // in-flight markers set the moment an admin acts, before Paystack's
  // resolve webhook confirms it — so the UI reflects the action
  // immediately instead of looking unchanged until the next webhook.
  status: 'awaiting-merchant-feedback' | 'awaiting-bank-feedback' | 'pending' | 'challenged' | 'accepted-loss' | 'resolved'
  resolution?: 'merchant-accepted' | 'declined'
  raisedAt: Date
  resolvedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const DisputeSchema = new Schema<IDispute>(
  {
    paystackDisputeId: {
      type: String,
      required: true,
      unique: true,
    },
    order: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },
    event: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['awaiting-merchant-feedback', 'awaiting-bank-feedback', 'pending', 'challenged', 'accepted-loss', 'resolved'],
      default: 'awaiting-merchant-feedback',
    },
    resolution: {
      type: String,
      enum: ['merchant-accepted', 'declined'],
    },
    raisedAt: {
      type: Date,
      required: true,
    },
    resolvedAt: {
      type: Date,
    },
  },
  { timestamps: true }
)

DisputeSchema.index({ status: 1, createdAt: -1 })

export default mongoose.model<IDispute>('Dispute', DisputeSchema)
