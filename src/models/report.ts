import mongoose, { Document, Schema } from 'mongoose'

/**
 * A single attendee-submitted report against an event or an organizer.
 * Multiple reports can point at the same subject — the admin Flags queue
 * groups these by (targetType, targetId) and shows a count, same as the
 * Figma's "5 reports" / "3 reports" badges. There's no separate "flag"
 * record: an event/organizer just IS flagged whenever it has >=1 open
 * report against it (see admin.controller.ts's listFlags).
 */
export interface IReport extends Document {
  _id: mongoose.Types.ObjectId
  targetType: 'event' | 'organizer'
  // For an organizer report, `event` is still kept — it's how the attendee
  // got here (reporting "the organizer of this event"), useful context on
  // the admin detail page even though the report is really about the
  // organizer, not the event itself.
  event: mongoose.Types.ObjectId
  organizer?: mongoose.Types.ObjectId
  reportedBy?: mongoose.Types.ObjectId
  reporterName: string
  reason: string
  status: 'open' | 'dismissed' | 'actioned'
  createdAt: Date
  updatedAt: Date
}

const ReportSchema = new Schema<IReport>(
  {
    targetType: {
      type: String,
      enum: ['event', 'organizer'],
      required: true,
    },
    event: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },
    organizer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    reportedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    // Denormalized at submission time so the admin list/detail views never
    // need an extra populate just to show who reported something — same
    // pattern as Ticket.attendeeName.
    reporterName: {
      type: String,
      trim: true,
      required: true,
    },
    reason: {
      type: String,
      trim: true,
      required: true,
    },
    status: {
      type: String,
      enum: ['open', 'dismissed', 'actioned'],
      default: 'open',
    },
  },
  { timestamps: true }
)

ReportSchema.index({ targetType: 1, event: 1, status: 1 })
ReportSchema.index({ targetType: 1, organizer: 1, status: 1 })

export default mongoose.model<IReport>('Report', ReportSchema)
