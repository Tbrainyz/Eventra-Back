import mongoose, { Document, Schema } from 'mongoose'

export interface IRefundRequest extends Document {
  _id: mongoose.Types.ObjectId
  ticket: mongoose.Types.ObjectId
  order: mongoose.Types.ObjectId
  event: mongoose.Types.ObjectId
  requestedBy?: mongoose.Types.ObjectId
  reason?: string
  amount: number
  status: 'pending' | 'approved' | 'rejected' | 'processed'
  rejectionReason?: string
  paystackRefundReference?: string
  processedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const RefundRequestSchema = new Schema<IRefundRequest>(
  {
    ticket: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    // Absent for a guest's ticket — the linked `ticket` already snapshots
    // attendeeName/attendeeEmail, so there's nothing else worth duplicating
    // here for a guest requester.
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'processed'],
      default: 'pending',
    },
    rejectionReason: { type: String, trim: true },
    paystackRefundReference: { type: String, trim: true },
    processedAt: { type: Date },
  },
  { timestamps: true }
)

RefundRequestSchema.index({ status: 1, createdAt: 1 })
RefundRequestSchema.index({ ticket: 1 })

const RefundRequest =
  mongoose.models.RefundRequest || mongoose.model<IRefundRequest>('RefundRequest', RefundRequestSchema, 'refund_requests')

export default RefundRequest
