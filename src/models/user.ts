import bcrypt from 'bcryptjs'
import mongoose, { Document, Schema } from 'mongoose'

export interface IOrganizerProfile {
  businessName?: string
  bankName?: string
  bankCode?: string
  accountNumber?: string
  accountName?: string
  isPayoutReady: boolean
  approvalStatus: 'pending' | 'approved' | 'rejected'
  paystackRecipientCode?: string
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
    bankName: { type: String, trim: true },
    bankCode: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    accountName: { type: String, trim: true },
    isPayoutReady: { type: Boolean, default: false },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    paystackRecipientCode: { type: String, trim: true },
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
        return !this.googleId
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
