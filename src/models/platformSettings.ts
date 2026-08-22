import mongoose, { Document, Schema } from 'mongoose'

/**
 * Single-document collection — there's only ever one settings row. Read via
 * getPlatformSettings() in lib/platformSettings.ts, which upserts a default
 * row on first read so every other part of the app can assume this always
 * exists rather than null-checking everywhere.
 */
export interface IPlatformSettings extends Document {
  _id: mongoose.Types.ObjectId
  // Snapshotted onto each Event at creation (Event.commissionRatePercent)
  // rather than read live at checkout — changing this here only affects
  // events created after the change, per the Settings page copy. Existing
  // events keep whatever rate was in effect when they were created.
  commissionRatePercent: number
  currency: string
  payoutHoldDays: number
  autoApproveEvents: boolean
  autoApprovePromotions: boolean
  maintenanceMode: boolean
  updatedAt: Date
}

const PlatformSettingsSchema = new Schema<IPlatformSettings>(
  {
    commissionRatePercent: { type: Number, default: 5, min: 0, max: 100 },
    currency: { type: String, default: 'NGN' },
    payoutHoldDays: { type: Number, default: 3, min: 0 },
    autoApproveEvents: { type: Boolean, default: false },
    autoApprovePromotions: { type: Boolean, default: false },
    maintenanceMode: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
)

export default mongoose.model<IPlatformSettings>('PlatformSettings', PlatformSettingsSchema)
