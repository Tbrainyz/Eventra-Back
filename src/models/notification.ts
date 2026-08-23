import mongoose, { Document, Schema } from 'mongoose'

/**
 * One row per in-app notification, for the bell dropdown on all three
 * surfaces (attendee, organizer, admin) — separate from the email system
 * (services/email.service.ts). Some events send both (e.g. an event
 * rejection triggers both sendEventRejectedEmail and a notification);
 * this collection only ever powers the bell/feed, never an email itself.
 */
export interface INotification extends Document {
  _id: mongoose.Types.ObjectId
  recipient: mongoose.Types.ObjectId
  type: string
  title: string
  message: string
  // In-app path the bell item links to when clicked — e.g.
  // `/organizer/events/${eventId}` or `/admin/approvals/events/${eventId}`.
  // Omitted for notifications with no obvious destination.
  link?: string
  read: boolean
  createdAt: Date
}

const NotificationSchema = new Schema<INotification>(
  {
    recipient: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    link: {
      type: String,
      trim: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

NotificationSchema.index({ recipient: 1, createdAt: -1 })
NotificationSchema.index({ recipient: 1, read: 1 })

export default mongoose.model<INotification>('Notification', NotificationSchema)
