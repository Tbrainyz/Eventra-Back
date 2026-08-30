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
  // Verification documents — collected in the onboarding wizard's
  // Verification step (between Bank and Review). Just Cloudinary URLs,
  // same pattern as Event.coverImage; nothing structured about them on
  // this side. Admin's organizer-review page reads these directly rather
  // than a separate endpoint.
  cacCertificateUrl?: string
  directorIdUrl?: string
  proofOfAddressUrl?: string
}

export interface INotificationPreferences {
  eventReminders: boolean
  weeklyPicks: boolean
  organizerUpdates: boolean
}

// Separate from INotificationPreferences above (which is the attendee-facing
// "My account" prefs) — these drive the toggles on the organizer dashboard's
// Settings page instead, and are meaningless for an attendee-only account.
export interface IOrganizerNotificationPreferences {
  newSalesRsvps: boolean
  dailySalesSummary: boolean
  payoutConfirmations: boolean
  eventApprovals: boolean
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
  organizerNotificationPreferences: IOrganizerNotificationPreferences
  role: 'attendee' | 'organizer' | 'admin'
  // Display-only sub-role for the "Admin, Teams & Roles" table on
  // Settings — actually enforced now via requireAdminTier
  // (middlewares/adminPermission.middleware.ts), not just a label.
  // Only meaningful when role === 'admin'. Treat as 'admin' when unset
  // (every admin account created before this field existed).
  adminRole?: 'owner' | 'admin' | 'support'
  isVerified: boolean
  isSuspended: boolean
  emailVerificationOTP?: string
  emailVerificationOTPExpiry?: Date
  passwordResetOTP?: string
  passwordResetOTPExpiry?: Date
  // Admin-invite tracking (see inviteAdmin in admin.controller.ts) — an
  // invited admin's account exists from the moment the invite is sent,
  // not just once they accept it, so "pending" has to be tracked
  // explicitly rather than inferred from isVerified (which is already
  // true for an invited account — see inviteAdmin's own comment on why).
  // Only ever set for role === 'admin' accounts created via invite, never
  // for accounts created through /auth/register.
  invitedAt?: Date
  invitedBy?: mongoose.Types.ObjectId
  inviteAcceptedAt?: Date
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
    cacCertificateUrl: { type: String, trim: true },
    directorIdUrl: { type: String, trim: true },
    proofOfAddressUrl: { type: String, trim: true },
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
        // Google sign-ups never collect a phone number, neither does the
        // organizer registration form, and neither does inviteAdmin
        // (admin.controller.ts) — an invited admin never fills out any
        // form at all before their account exists. Only a manual
        // attendee sign-up actually needs one.
        return !this.googleId && this.role !== 'organizer' && this.role !== 'admin'
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
    // All default false — an organizer opts in per the Settings page,
    // rather than getting opted into ops emails by default.
    organizerNotificationPreferences: {
      newSalesRsvps: { type: Boolean, default: false },
      dailySalesSummary: { type: Boolean, default: false },
      payoutConfirmations: { type: Boolean, default: false },
      eventApprovals: { type: Boolean, default: false },
    },
    role: {
      type: String,
      enum: ['attendee', 'organizer', 'admin'],
      default: 'attendee',
    },
    adminRole: {
      type: String,
      enum: ['owner', 'admin', 'support'],
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
    invitedAt: {
      type: Date,
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    inviteAcceptedAt: {
      type: Date,
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
