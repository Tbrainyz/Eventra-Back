import mongoose, { Document, Schema } from 'mongoose'

/**
 * One row per admin action — powers both the Overview "Recent activity"
 * card and Reports > Audit log. Written via lib/auditLog.ts's `logAdminAction`
 * helper, called at the end of each admin controller action (approve/
 * reject/flag/remove/suspend/release-payout/etc.) right after that
 * action's own DB write succeeds — not a generic before/after diff of the
 * whole document, just a short human-readable summary of what happened.
 */
export interface IAuditLog extends Document {
  _id: mongoose.Types.ObjectId
  action: string
  targetLabel: string
  admin: mongoose.Types.ObjectId
  adminName: string
  createdAt: Date
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    action: {
      type: String,
      trim: true,
      required: true,
    },
    targetLabel: {
      type: String,
      trim: true,
      required: true,
    },
    admin: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    adminName: {
      type: String,
      trim: true,
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

AuditLogSchema.index({ createdAt: -1 })

export default mongoose.model<IAuditLog>('AuditLog', AuditLogSchema)
