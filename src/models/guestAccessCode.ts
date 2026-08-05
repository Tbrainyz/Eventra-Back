import mongoose, { Document, Schema } from 'mongoose'

/**
 * Backs the "track my ticket by email" flow for people who checked out or
 * RSVP'd as a guest (no account) and want to view/manage their ticket
 * later — whether or not the confirmation email actually arrived. A code
 * sent to `email` proves inbox ownership; on success the controller sets
 * `req.session.guestEmail`, which is then trusted the same way
 * `req.session.userId` is for a real account (see lib/attendee.ts and the
 * ownership checks in cancelReservation/requestRefund).
 *
 * Deliberately its own tiny collection rather than reusing the Memcached
 * cache in lib/cache.ts — that cache is explicitly best-effort (silently
 * returns null on any error), which is fine for response caching but not
 * for something a real flow depends on to function at all.
 */
export interface IGuestAccessCode extends Document {
  email: string
  otp: string
  otpExpiry: Date
  createdAt: Date
}

const GuestAccessCodeSchema = new Schema<IGuestAccessCode>({
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  otp: {
    type: String,
    required: true,
  },
  otpExpiry: {
    type: Date,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
})

GuestAccessCodeSchema.index({ email: 1 })
// TTL index — Mongo auto-deletes a code once its expiry passes, so stale
// codes never pile up and can't be reused after the fact.
GuestAccessCodeSchema.index({ otpExpiry: 1 }, { expireAfterSeconds: 0 })

const GuestAccessCode =
  mongoose.models.GuestAccessCode || mongoose.model<IGuestAccessCode>('GuestAccessCode', GuestAccessCodeSchema, 'guestAccessCodes')

export default GuestAccessCode
