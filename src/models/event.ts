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
  role?: string
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
  // Only `type` is guaranteed to be set on a fresh draft — the rest fill
  // in progressively as the create-event wizard's steps are completed.
  // submitEventForApproval is what actually enforces these being present
  // before an event can go live, not the schema itself.
  title?: string
  slug: string
  description?: string
  category?: mongoose.Types.ObjectId
  type: 'free' | 'paid'
  coverImage?: string
  // Physical venue — absent when isOnline is true.
  venue?: IEventVenue
  isOnline: boolean
  onlinePlatform?: string
  // Deliberately never exposed on the public event API response before
  // someone has RSVP'd/bought — see getEventBySlug's response shaping.
  onlineJoinLink?: string
  startDate?: Date
  endDate?: Date
  capacity?: number
  refundPolicy?: IRefundPolicy
  // Artists/speakers/influencers billed for the event — a selling point on
  // the public event page, entirely organizer-managed. Order in the array
  // is display order (headliners first).
  lineup: IEventLineupMember[]
  // Free-form keywords an organizer picks to describe the vibe/genre of
  // their event (e.g. "Afrobeats", "Outdoor", "18+") — shown as pills on
  // the public event page. Distinct from `category` (one required taxonomy
  // pick) and `agePolicy` (a single age-restriction value): tags are
  // optional, multiple, and organizer's own words.
  tags: string[]
  gallery: string[]
  // Free text on purpose (e.g. "All Ages", "18+") rather than an enum —
  // the wizard's dropdown offers common presets but organizers in
  // different event categories phrase this differently enough that a
  // fixed enum would fight them.
  agePolicy?: string
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
  role: { type: String, trim: true },
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
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
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
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    onlinePlatform: {
      type: String,
      trim: true,
    },
    onlineJoinLink: {
      type: String,
      trim: true,
    },
    startDate: {
      type: Date,
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
    gallery: {
      type: [String],
      default: [],
    },
    tags: {
      type: [String],
      default: [],
    },
    agePolicy: {
      type: String,
      trim: true,
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
EventSchema.index({ title: 'text', description: 'text', 'venue.name': 'text', 'venue.address': 'text', 'venue.city': 'text' })

const Event = mongoose.models.Event || mongoose.model<IEvent>('Event', EventSchema, 'events')

export default Event
