import mongoose, { Document, Schema } from 'mongoose'

export interface IEventVenue {
  name: string
  address: string
  city: string
  state?: string
}

export interface IRefundPolicy {
  type: 'no-refunds' | 'refund-until-days-before'
  daysBefore?: number
}

export interface IEventLineupMember {
  _id: mongoose.Types.ObjectId
  name: string
  role: string
  imageUrl?: string
}

export interface IEventPromotion {
  package: string
  status: 'pending' | 'approved' | 'rejected'
  startsAt?: Date
  endsAt?: Date
  paidAt?: Date
  paystackReference?: string
}

export interface IEvent extends Document {
  _id: mongoose.Types.ObjectId
  organizer: mongoose.Types.ObjectId
  title: string
  slug: string
  description: string
  category: mongoose.Types.ObjectId
  type: 'free' | 'paid'
  coverImage?: string
  venue: IEventVenue
  startDate: Date
  endDate?: Date
  capacity?: number
  refundPolicy?: IRefundPolicy
  // Artists/speakers/influencers billed for the event — a selling point on
  // the public event page, entirely organizer-managed. Order in the array
  // is display order (headliners first).
  lineup: IEventLineupMember[]
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'cancelled' | 'postponed'
  rejectionReason?: string
  isPromoted: boolean
  promotion?: IEventPromotion
  reservationsCount: number
  ticketsSoldCount: number
  revenueTotal: number
  minPrice: number
  publishedAt?: Date
  cancelledAt?: Date
  postponedTo?: Date
  createdAt: Date
  updatedAt: Date
}

const EventVenueSchema = new Schema<IEventVenue>(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, trim: true },
  },
  { _id: false }
)

const RefundPolicySchema = new Schema<IRefundPolicy>(
  {
    type: {
      type: String,
      enum: ['no-refunds', 'refund-until-days-before'],
      default: 'no-refunds',
    },
    daysBefore: { type: Number, min: 0 },
  },
  { _id: false }
)

const EventPromotionSchema = new Schema<IEventPromotion>(
  {
    package: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    startsAt: { type: Date },
    endsAt: { type: Date },
    paidAt: { type: Date },
    paystackReference: { type: String, trim: true },
  },
  { _id: false }
)

const LineupMemberSchema = new Schema<IEventLineupMember>({
  name: { type: String, required: true, trim: true },
  role: { type: String, required: true, trim: true },
  imageUrl: { type: String, trim: true },
})

const EventSchema = new Schema<IEvent>(
  {
    organizer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    type: {
      type: String,
      enum: ['free', 'paid'],
      required: true,
    },
    coverImage: {
      type: String,
      trim: true,
    },
    venue: {
      type: EventVenueSchema,
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
    },
    capacity: {
      type: Number,
      min: 0,
    },
    refundPolicy: {
      type: RefundPolicySchema,
    },
    lineup: {
      type: [LineupMemberSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'postponed'],
      default: 'draft',
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    isPromoted: {
      type: Boolean,
      default: false,
    },
    promotion: {
      type: EventPromotionSchema,
    },
    reservationsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    ticketsSoldCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    revenueTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Denormalized from the cheapest active TicketType (0 for free events, which
    // have none). Kept in sync by ticketType.controller.ts on every create/update —
    // exists so Explore's price filter/sort can query Event directly instead of
    // joining to TicketType on every request.
    minPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    publishedAt: {
      type: Date,
    },
    cancelledAt: {
      type: Date,
    },
    postponedTo: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
)

// Indexes — support Explore/search, organizer dashboard, and featured placement
EventSchema.index({ organizer: 1, createdAt: -1 })
EventSchema.index({ status: 1, startDate: 1 })
EventSchema.index({ category: 1, startDate: 1 })
EventSchema.index({ 'venue.city': 1 })
EventSchema.index({ isPromoted: -1, startDate: 1 })
EventSchema.index({ status: 1, minPrice: 1 })
EventSchema.index({ title: 'text', description: 'text' })

const Event = mongoose.models.Event || mongoose.model<IEvent>('Event', EventSchema, 'events')

export default Event
