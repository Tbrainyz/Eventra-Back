import { Request, Response } from 'express'
import { env } from '../config/keys.js'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import { generateOTP, sanitizeUser } from '../lib/utils.js'
import User from '../models/user.js'
import { EmailService } from '../services/email.service.js'
import { GoogleAuthService } from '../services/google-auth.service.js'

const OTP_TTL_MS = 15 * 60 * 1000 // 15 minutes, matches the email copy

// Organizer auth lives under its own branded route tree (/organizer/auth/*)
// rather than the attendee one (/auth/*) — same account system, different
// shell (see routes/organizer/auth on the client). The verification email
// needs to land the person back on whichever shell they signed up through.
function verifyEmailLink(email: string, role: 'attendee' | 'organizer') {
  const path = role === 'organizer' ? '/organizer/auth/verify-email' : '/auth/verify-email'
  return `${env.CLIENT_URL}${path}?email=${encodeURIComponent(email)}`
}

export const register = tryCatchWrapper(async (req: Request, res: Response) => {
  const { fullname, email, password, phone, role } = req.body
  const resolvedRole = role === 'organizer' ? 'organizer' : 'attendee'

  const existingUser = await User.findOne({ email }).lean()
  if (existingUser) {
    return sendTsRestError(res, 409, 'An account with this email already exists')
  }

  const otp = generateOTP()

  const user = await User.create({
    fullname,
    email,
    password,
    phone,
    role: resolvedRole,
    emailVerificationOTP: otp,
    emailVerificationOTPExpiry: new Date(Date.now() + OTP_TTL_MS),
  })

  await EmailService.sendVerifyAccountEmail({
    user,
    otp,
    link: verifyEmailLink(email, resolvedRole),
  })

  return sendTsRestSuccess(res, 201, {
    success: true,
    message: 'Account created. Check your email for a verification code.',
    body: { email: user.email },
  })
})

export const verifyEmail = tryCatchWrapper(async (req: Request, res: Response) => {
  const { email, otp } = req.body

  const user = await User.findOne({ email }).select('+emailVerificationOTP +emailVerificationOTPExpiry')
  if (!user) {
    return sendTsRestError(res, 404, 'No account found with this email')
  }

  if (user.isVerified) {
    return sendTsRestError(res, 400, 'This account is already verified')
  }

  if (!user.emailVerificationOTP || !user.emailVerificationOTPExpiry) {
    return sendTsRestError(res, 400, 'No verification code was requested for this account')
  }

  if (user.emailVerificationOTPExpiry.getTime() < Date.now()) {
    return sendTsRestError(res, 400, 'Verification code has expired. Please request a new one')
  }

  if (user.emailVerificationOTP !== otp) {
    return sendTsRestError(res, 400, 'Invalid verification code')
  }

  user.isVerified = true
  user.emailVerificationOTP = undefined
  user.emailVerificationOTPExpiry = undefined
  await user.save()

  req.session.userId = user._id.toString()
  req.session.role = user.role
  req.session.adminRole = user.role === 'admin' ? (user.adminRole ?? 'admin') : undefined

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Email verified successfully',
    body: sanitizeUser(user.toObject()),
  })
})

export const resendOtp = tryCatchWrapper(async (req: Request, res: Response) => {
  const { email } = req.body

  const user = await User.findOne({ email })
  if (!user) {
    return sendTsRestError(res, 404, 'No account found with this email')
  }

  if (user.isVerified) {
    return sendTsRestError(res, 400, 'This account is already verified')
  }

  const otp = generateOTP()
  user.emailVerificationOTP = otp
  user.emailVerificationOTPExpiry = new Date(Date.now() + OTP_TTL_MS)
  await user.save()

  await EmailService.sendVerifyAccountEmail({
    user,
    otp,
    link: verifyEmailLink(email, user.role === 'organizer' ? 'organizer' : 'attendee'),
  })

  return sendTsRestSuccess<undefined>(res, 200, {
    success: true,
    message: 'A new verification code has been sent to your email',
  })
})

export const googleAuth = tryCatchWrapper(async (req: Request, res: Response) => {
  const { accessToken, role } = req.body

  let profile
  try {
    profile = await GoogleAuthService.verifyAccessToken(accessToken)
  } catch (error: any) {
    return sendTsRestError(res, 401, error.message || 'Google sign-in failed')
  }

  if (!profile.emailVerified) {
    return sendTsRestError(res, 401, "Your Google account's email isn't verified")
  }

  let user = await User.findOne({ googleId: profile.sub })

  if (!user) {
    // Someone who registered normally with this email, now trying Google
    // for the first time — link it to the existing account rather than
    // creating a second, disconnected one with the same email address.
    user = await User.findOne({ email: profile.email })
    if (user) {
      user.googleId = profile.sub
      if (!user.avatarUrl && profile.picture) user.avatarUrl = profile.picture
      await user.save()
    }
  }

  if (!user) {
    user = await User.create({
      fullname: profile.name,
      email: profile.email,
      googleId: profile.sub,
      avatarUrl: profile.picture,
      // Only matters for a brand-new account — if this email already
      // exists (linked above) we keep whatever role it already has.
      // "Sign up with Google" on the organizer register page sends
      // role: 'organizer' here so it doesn't silently create an
      // attendee account instead.
      role: role === 'organizer' ? 'organizer' : 'attendee',
      // Google already verified this email address — our own OTP flow
      // would be redundant friction, not extra security.
      isVerified: true,
    })
  }

  if (user.isSuspended) {
    return sendTsRestError(res, 403, 'This account has been suspended. Contact support for help')
  }

  // Same cross-portal guard as the password login path below — `role`
  // here doubles as which Google button was clicked (attendee vs
  // organizer; admin has no Google option), so an existing account of a
  // different role can't sign in through the wrong portal's button
  // either. A brand-new account always matches trivially, since it was
  // just created a few lines up with this exact role.
  if (role) {
    const isOrganizerInProgress = role === 'organizer' && user.role === 'attendee' && Boolean(user.organizerProfile)
    if (user.role !== role && !isOrganizerInProgress) {
      return sendTsRestError(res, 401, `No ${role} account found with this email`)
    }
  }

  req.session.userId = user._id.toString()
  req.session.role = user.role
  req.session.adminRole = user.role === 'admin' ? (user.adminRole ?? 'admin') : undefined

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Signed in with Google',
    body: sanitizeUser(user.toObject()),
  })
})

export const login = tryCatchWrapper(async (req: Request, res: Response) => {
  const { email, password, context } = req.body

  const user = await User.findOne({ email }).select('+password')
  if (!user) {
    return sendTsRestError(res, 401, 'Invalid email or password')
  }

  if (user.isSuspended) {
    return sendTsRestError(res, 403, 'This account has been suspended. Contact support for help')
  }

  if (!user.password) {
    return sendTsRestError(res, 401, 'This account uses Google Sign-In. Continue with Google instead.')
  }

  const passwordMatches = await user.matchPassword(password)
  if (!passwordMatches) {
    return sendTsRestError(res, 401, 'Invalid email or password')
  }

  if (!user.isVerified) {
    return sendTsRestError(res, 403, 'Please verify your email before logging in')
  }

  // Each portal (attendee /auth/login, organizer /organizer/auth/login,
  // admin /admin/auth/login) only ever wants accounts of its own role —
  // without this, correct credentials for any account worked on any of
  // the three login pages, since they all hit this same endpoint.
  // Organizer is the one exception: someone mid-onboarding (has started
  // an organizerProfile but hasn't submitted it for review yet — see
  // submitOrganizerProfileForReview, the only other place role flips to
  // 'organizer') still has role 'attendee' and needs to get back into
  // their in-progress setup, so that case is let through too.
  if (context) {
    const isOrganizerInProgress = context === 'organizer' && user.role === 'attendee' && Boolean(user.organizerProfile)
    if (user.role !== context && !isOrganizerInProgress) {
      return sendTsRestError(res, 401, `No ${context} account found with this email`)
    }
  }

  req.session.userId = user._id.toString()
  req.session.role = user.role
  req.session.adminRole = user.role === 'admin' ? (user.adminRole ?? 'admin') : undefined

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Logged in successfully',
    body: sanitizeUser(user.toObject()),
  })
})

export const logout = tryCatchWrapper(async (req: Request, res: Response) => {
  req.session.destroy(err => {
    if (err) {
      return sendTsRestError(res, 500, 'Could not log out, please try again')
    }
    res.clearCookie('_evtSessionId')
    return sendTsRestSuccess<undefined>(res, 200, {
      success: true,
      message: 'Logged out successfully',
    })
  })
})

export const me = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId).lean()
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Current user fetched',
    body: sanitizeUser(user),
  })
})

export const forgotPassword = tryCatchWrapper(async (req: Request, res: Response) => {
  const { email } = req.body

  const user = await User.findOne({ email })

  // Same response whether or not the account exists — avoids leaking which emails are registered.
  const genericResponse = () =>
    sendTsRestSuccess<undefined>(res, 200, {
      success: true,
      message: 'If an account exists for this email, a reset code has been sent',
    })

  if (!user) {
    return genericResponse()
  }

  const otp = generateOTP()
  user.passwordResetOTP = otp
  user.passwordResetOTPExpiry = new Date(Date.now() + OTP_TTL_MS)
  await user.save()

  // A still-pending invitee using "Resend code" on the accept-invite page
  // (they're not logged in, so they can't hit the owner-only
  // resendAdminInvite endpoint) hits this same public endpoint — send the
  // invite-flavored email here too, not the generic "reset your
  // password" one, so the copy stays consistent with what got them here.
  if (user.invitedAt && !user.inviteAcceptedAt) {
    const inviter = user.invitedBy ? await User.findById(user.invitedBy).select('fullname').lean() : null
    await EmailService.sendAdminInviteEmail({
      user,
      otp,
      inviterName: inviter?.fullname ?? 'An admin',
      roleLabel: user.adminRole === 'support' ? 'a Support' : 'an Admin',
    })
  } else {
    await EmailService.sendPasswordResetEmail({ user, otp })
  }

  return genericResponse()
})

export const resetPassword = tryCatchWrapper(async (req: Request, res: Response) => {
  const { email, otp, newPassword } = req.body

  const user = await User.findOne({ email }).select('+passwordResetOTP +passwordResetOTPExpiry')
  if (!user) {
    return sendTsRestError(res, 404, 'No account found with this email')
  }

  if (!user.passwordResetOTP || !user.passwordResetOTPExpiry) {
    return sendTsRestError(res, 400, 'No password reset was requested for this account')
  }
  if (user.passwordResetOTPExpiry.getTime() < Date.now()) {
    return sendTsRestError(res, 400, 'Reset code has expired. Please request a new one')
  }
  if (user.passwordResetOTP !== otp) {
    return sendTsRestError(res, 400, 'Invalid reset code')
  }

  user.password = newPassword
  user.passwordResetOTP = undefined
  user.passwordResetOTPExpiry = undefined
  // If this was an invited admin's first-ever password set (not a normal
  // "I forgot my password" reset), mark the invite accepted — this is
  // what flips them from PENDING to a real team member on Settings.
  // Harmless no-op for every other account, since invitedAt is only ever
  // set by inviteAdmin.
  if (user.invitedAt && !user.inviteAcceptedAt) {
    user.inviteAcceptedAt = new Date()
  }
  await user.save()

  return sendTsRestSuccess<undefined>(res, 200, {
    success: true,
    message: 'Password reset successfully. You can now log in',
  })
})
