import bcrypt from 'bcryptjs'
import mongoose, { Document, Schema } from 'mongoose'

export interface IOrganizerProfile {
  businessName?: string
  category?: string
  city?: string
  contactPhone?: string
  publicEmail?: string
  bio?: string
  bankName?: string
  bankCode?: string
  accountNumber?: string
  accountName?: string
  isPayoutReady: boolean
  // 'draft' — onboarding wizard in progress, not yet submitted (not shown
  // to admins). 'pending' — submitted, awaiting admin review. Set by
  // submitOrganizerProfileForReview, not by every profile edit.
  approvalStatus: 'draft' | 'pending' | 'approved' | 'rejected'
  paystackRecipientCode?: string
  agreedToTerms?: boolean
  submittedAt?: Date
}

export interface INotificationPreferences {
  eventReminders: boolean
  weeklyPicks: boolean
  organizerUpdates: boolean
}

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId
  fullname: string
  email: string
  password?: string
  googleId?: string
  phone?: string
  city?: string
  avatarUrl?: string
  avatarPublicId?: string
  notificationPreferences: INotificationPreferences
  role: 'attendee' | 'organizer' | 'admin'
  isVerified: boolean
  isSuspended: boolean
  emailVerificationOTP?: string
  emailVerificationOTPExpiry?: Date
  passwordResetOTP?: string
  passwordResetOTPExpiry?: Date
  organizerProfile?: IOrganizerProfile
  savedEvents: mongoose.Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
  matchPassword: (candidate: string) => Promise<boolean>
}

const OrganizerProfileSchema = new Schema<IOrganizerProfile>(
  {
    businessName: { type: String, trim: true },
    category: { type: String, trim: true },
    city: { type: String, trim: true },
    contactPhone: { type: String, trim: true },
    publicEmail: { type: String, trim: true, lowercase: true },
    bio: { type: String, trim: true, maxlength: 280 },
    bankName: { type: String, trim: true },
    bankCode: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    accountName: { type: String, trim: true },
    isPayoutReady: { type: Boolean, default: false },
    approvalStatus: {
      type: String,
      enum: ['draft', 'pending', 'approved', 'rejected'],
      default: 'draft',
    },
    paystackRecipientCode: { type: String, trim: true },
    agreedToTerms: { type: Boolean, default: false },
    submittedAt: { type: Date },
  },
  { _id: false }
)

const UserSchema = new Schema<IUser>(
  {
    fullname: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      // Google-created accounts never set a password — required is a
      // function so this only applies to accounts that signed up the
      // normal way. See matchPassword and googleAuth in auth.controller.ts
      // for the two places that read this and need to handle it being unset.
      required: function (this: IUser) {
        return !this.googleId
      },
      select: false,
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true, // most users won't have one — sparse means the unique index ignores documents missing this field entirely
    },
    phone: {
      type: String,
      required: function (this: IUser) {
        // Google sign-ups never collect a phone number, and neither does
        // the organizer registration form — only a manual attendee
        // sign-up needs one.
        return !this.googleId && this.role !== 'organizer'
      },
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    avatarUrl: {
      type: String,
    },
    avatarPublicId: {
      type: String,
      select: false, // internal Cloudinary bookkeeping, never needs to leave the server
    },
    notificationPreferences: {
      eventReminders: { type: Boolean, default: true },
      weeklyPicks: { type: Boolean, default: true },
      organizerUpdates: { type: Boolean, default: false },
    },
    role: {
      type: String,
      enum: ['attendee', 'organizer', 'admin'],
      default: 'attendee',
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isSuspended: {
      type: Boolean,
      default: false,
    },
    emailVerificationOTP: {
      type: String,
      select: false,
    },
    emailVerificationOTPExpiry: {
      type: Date,
      select: false,
    },
    passwordResetOTP: {
      type: String,
      select: false,
    },
    passwordResetOTPExpiry: {
      type: Date,
      select: false,
    },
    organizerProfile: {
      type: OrganizerProfileSchema,
      default: undefined,
    },
    savedEvents: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Event',
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
)

// Hash password before saving whenever it's new or modified
UserSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return
  const salt = await bcrypt.genSalt(10)
  this.password = await bcrypt.hash(this.password, salt)
})

UserSchema.methods.matchPassword = async function (candidate: string): Promise<boolean> {
  if (!this.password) return false // Google-only account — see googleAuth in auth.controller.ts
  return bcrypt.compare(candidate, this.password)
}

// Indexes
UserSchema.index({ role: 1 })

const User = mongoose.models.User || mongoose.model<IUser>('User', UserSchema, 'users')

export default User
