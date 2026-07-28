import mongoose, { Document, Schema } from 'mongoose'

export interface ITicketType extends Document {
  _id: mongoose.Types.ObjectId
  event: mongoose.Types.ObjectId
  name: string
  description?: string
  price: number
  quantity: number
  quantitySold: number
  purchaseLimitPerPerson: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  quantityRemaining: number
}

const TicketTypeSchema = new Schema<ITicketType>(
  {
    event: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    quantitySold: {
      type: Number,
      default: 0,
      min: 0,
    },
    purchaseLimitPerPerson: {
      type: Number,
      default: 10,
      min: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
)

// Remaining stock — used everywhere availability is shown or checked
TicketTypeSchema.virtual('quantityRemaining').get(function (this: ITicketType) {
  return Math.max(this.quantity - this.quantitySold, 0)
})

// Indexes
TicketTypeSchema.index({ event: 1, isActive: 1 })

const TicketType =
  mongoose.models.TicketType || mongoose.model<ITicketType>('TicketType', TicketTypeSchema, 'ticket_types')

export default TicketType
