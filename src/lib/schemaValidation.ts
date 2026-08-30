import { z } from 'zod'

export const registerSchema = z.object({
  fullname: z.string().trim().min(2, 'Fullname must be at least 2 characters'),
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  // Optional here because the organizer sign-up form doesn't collect a
  // phone number (see the Figma) — enforced as required for attendees at
  // the client-side schema instead (lib/schema.ts's registerSchema),
  // since that's a UX choice, not a data-integrity one.
  phone: z.string().trim().min(7, 'Invalid phone number').optional(),
  role: z.enum(['attendee', 'organizer']).optional(),
})

export const verifyEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
})

export const resendOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
})

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  // Which login page this came through — attendee (/auth/login), organizer
  // (/organizer/auth/login), or admin (/admin/auth/login). Optional so
  // existing API clients that don't send it still work exactly as before;
  // when present, the login controller rejects a real password match if
  // the account's actual role doesn't match, so an organizer's or admin's
  // credentials can't be used to sign into the attendee-facing app (or
  // vice versa) just because they hit the same underlying endpoint.
  context: z.enum(['attendee', 'organizer', 'admin']).optional(),
})

export const googleAuthSchema = z.object({
  accessToken: z.string().min(1, 'accessToken is required'),
  role: z.enum(['attendee', 'organizer']).optional(),
})

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
})

export const resetPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
})

export const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        ticketTypeId: z.string().trim().min(1, 'ticketTypeId is required'),
        quantity: z.number().int().positive('quantity must be a positive integer'),
      })
    )
    .min(1, 'At least one ticket item is required'),
  // Only required when there's no session — resolveAttendeeInfo
  // (lib/attendee.ts) is what actually enforces that, since it depends on
  // req.session, which isn't visible to a Zod schema.
  guestName: z.string().trim().min(2).optional(),
  guestEmail: z.string().trim().toLowerCase().email().optional(),
  guestPhone: z.string().trim().min(7).optional(),
})

export const organizerProfileSchema = z.object({
  businessName: z.string().trim().min(2).optional(),
  category: z.string().trim().min(1).optional(),
  city: z.string().trim().min(2).optional(),
  contactPhone: z.string().trim().min(7).optional(),
  publicEmail: z.string().trim().toLowerCase().email().optional(),
  bio: z.string().trim().max(280).optional(),
  bankName: z.string().trim().min(2).optional(),
  bankCode: z.string().trim().min(2).optional(),
  accountNumber: z.string().trim().min(10).max(10).optional(),
  accountName: z.string().trim().min(2).optional(),
  agreedToTerms: z.boolean().optional(),
  cacCertificateUrl: z.string().trim().url().optional(),
  directorIdUrl: z.string().trim().url().optional(),
  proofOfAddressUrl: z.string().trim().url().optional(),
})

export const organizerNotificationPreferencesSchema = z.object({
  newSalesRsvps: z.boolean().optional(),
  dailySalesSummary: z.boolean().optional(),
  payoutConfirmations: z.boolean().optional(),
  eventApprovals: z.boolean().optional(),
})

export const resolveBankAccountSchema = z.object({
  accountNumber: z.string().trim().min(10).max(10),
  bankCode: z.string().trim().min(2),
})

const venueSchema = z.object({
  name: z.string().trim().min(2),
  address: z.string().trim().min(3),
  city: z.string().trim().min(2),
  state: z.string().trim().optional(),
})

export const lineupMemberSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  // Optional — collected directly in the event-creation wizard's Line-Up
  // step now, same as name/imageUrl, but still not required: an organizer
  // can add just a name and fill in role/photo later from the dedicated
  // lineup editor (organizer/events/:id/lineup).
  role: z.string().trim().optional(),
  imageUrl: z.string().trim().url().optional(),
})

export const updateEventLineupSchema = z.object({
  lineup: z.array(lineupMemberSchema).max(30, 'Lineup can have at most 30 entries'),
})

export const createEventSchema = z.object({
  // Only `type` is required to create a draft — the wizard creates the
  // event as soon as Step 1 (Type) is chosen, then fills the rest in via
  // updateEvent across the remaining steps. Same pattern as
  // organizerProfileSchema/submitOrganizerProfileForReview: everything
  // else is validated for real at submitEventForApproval, not here.
  type: z.enum(['free', 'paid']),
  title: z.string().trim().min(3, 'Title must be at least 3 characters').optional(),
  description: z.string().trim().min(10, 'Description must be at least 10 characters').optional(),
  category: z.string().trim().min(1, 'category is required').optional(),
  coverImage: z.string().trim().url().optional(),
  // Physical venue — required unless isOnline is true. See the isOnline
  // fields below for the online-event alternative.
  venue: venueSchema.optional(),
  isOnline: z.boolean().optional(),
  onlinePlatform: z.string().trim().optional(),
  onlineJoinLink: z.string().trim().url().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  capacity: z.number().int().positive().optional(),
  refundPolicy: z
    .object({
      type: z.enum(['no-refunds', 'refund-until-days-before']),
      daysBefore: z.number().int().min(0).optional(),
    })
    .optional(),
  // Whole-array replace on every save — organizer submits the current full
  // lineup each time rather than individual add/remove diffs. Simpler
  // contract, and Mongo assigns fresh _ids to any new entries regardless.
  lineup: z.array(lineupMemberSchema).max(30, 'Lineup can have at most 30 entries').optional(),
  gallery: z.array(z.string().trim().url()).max(20, 'Gallery can have at most 20 photos').optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10, 'Up to 10 tags').optional(),
  agePolicy: z.string().trim().optional(),
})

export const updateEventSchema = createEventSchema.partial()

export const createTicketTypeSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  description: z.string().trim().max(200).optional(),
  price: z.number().min(0),
  quantity: z.number().int().positive(),
  purchaseLimitPerPerson: z.number().int().positive().optional(),
})

export const updateTicketTypeSchema = createTicketTypeSchema.partial().extend({
  isActive: z.boolean().optional(),
})

export const createCategorySchema = z.object({
  name: z.string().trim().min(2, 'name is required'),
})

export const updateCategorySchema = z.object({
  name: z.string().trim().min(2).optional(),
  isActive: z.boolean().optional(),
})

export const rejectEventSchema = z.object({
  reason: z.string().trim().min(3, 'A rejection reason is required'),
})

export const rsvpSchema = z.object({
  guests: z.number().int().min(1).max(4).optional(),
  // Same deal as checkoutSchema — only actually required when there's no
  // session, enforced by resolveAttendeeInfo, not here.
  guestName: z.string().trim().min(2).optional(),
  guestEmail: z.string().trim().toLowerCase().email().optional(),
  guestPhone: z.string().trim().min(7).optional(),
})

export const guestTicketAccessRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
})

export const guestTicketAccessVerifySchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  otp: z.string().trim().length(6, 'Enter the 6-digit code'),
})

export const updateProfileSchema = z
  .object({
    fullname: z.string().trim().min(2).optional(),
    phone: z.string().trim().min(7).optional(),
    city: z.string().trim().min(1).optional(),
    notificationPreferences: z
      .object({
        eventReminders: z.boolean().optional(),
        weeklyPicks: z.boolean().optional(),
        organizerUpdates: z.boolean().optional(),
      })
      .partial()
      .optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8).optional(),
  })
  .refine(data => !data.newPassword || !!data.currentPassword, {
    message: 'currentPassword is required to set a new password',
    path: ['currentPassword'],
  })

export const refundRequestSchema = z.object({
  reason: z.string().trim().max(500).optional(),
})

export const checkInSchema = z.object({
  code: z.string().trim().min(1, 'code is required'),
})

export const requestPromotionSchema = z.object({
  packageId: z.string().trim().min(1, 'packageId is required'),
})

export const postponeEventSchema = z.object({
  newStartDate: z.coerce.date(),
  reason: z.string().trim().min(3, 'A reason is required').max(500).optional(),
})

export const cancelEventSchema = z.object({
  reason: z.string().trim().min(3, 'A reason is required').max(500),
})

export const reportEventSchema = z.object({
  targetType: z.enum(['event', 'organizer']),
  reason: z.string().trim().min(10, 'Give a bit more detail (at least 10 characters)').max(500),
})

// 'owner' is deliberately excluded — an owner invites peers into the two
// lower tiers only, never hands out ownership through the invite flow.
// Promoting someone to owner (if that's ever needed) is a separate,
// harder-to-misuse action, not this form.
export const inviteAdminSchema = z.object({
  fullname: z.string().trim().min(2, 'Fullname must be at least 2 characters'),
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  adminRole: z.enum(['admin', 'support']),
})

export const challengeDisputeSchema = z.object({
  serviceDetails: z.string().trim().min(10, 'Give a bit more detail (at least 10 characters)').max(1000),
})

export const settingsUpdateSchema = z.object({
  commissionRatePercent: z.number().min(0).max(100).optional(),
  currency: z.string().trim().min(1).optional(),
  payoutHoldDays: z.number().int().min(0).optional(),
  autoApproveEvents: z.boolean().optional(),
  autoApprovePromotions: z.boolean().optional(),
  maintenanceMode: z.boolean().optional(),
})

export const adminRoleUpdateSchema = z.object({
  adminRole: z.enum(['owner', 'admin', 'support']),
})
