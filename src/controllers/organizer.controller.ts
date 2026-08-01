import { Request, Response } from 'express'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import { buildPaginationMeta, getPagination, sanitizeUser } from '../lib/utils.js'
import Event from '../models/event.js'
import Order from '../models/order.js'
import User, { IOrganizerProfile } from '../models/user.js'
import { PaystackService } from '../services/paystack.service.js'

/**
 * Create or update the caller's organizer profile (org info + bank
 * details). This is the wizard's "save as you go" endpoint — each step
 * (About your organization, Bank account) and "Save & exit" all call this
 * with just the fields that step collected, so it only ever merges over
 * the existing profile rather than replacing it.
 *
 * Submitting new bank details on an already-*approved* profile resets it
 * to 'pending' — an admin must re-verify before payouts resume. Editing
 * anything else, or editing while still in 'draft' (i.e. the wizard isn't
 * submitted yet), never changes approvalStatus — that only moves forward
 * via submitOrganizerProfileForReview below.
 */
export const upsertOrganizerProfile = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId)
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  const existing = user.organizerProfile
  const bankDetailsChanged =
    !!existing &&
    ((req.body.accountNumber && req.body.accountNumber !== existing.accountNumber) ||
      (req.body.bankCode && req.body.bankCode !== existing.bankCode))

  const nextApprovalStatus: IOrganizerProfile['approvalStatus'] =
    existing?.approvalStatus === 'approved' && bankDetailsChanged ? 'pending' : (existing?.approvalStatus ?? 'draft')

  user.organizerProfile = {
    businessName: req.body.businessName ?? existing?.businessName,
    category: req.body.category ?? existing?.category,
    city: req.body.city ?? existing?.city,
    contactPhone: req.body.contactPhone ?? existing?.contactPhone,
    publicEmail: req.body.publicEmail ?? existing?.publicEmail,
    bio: req.body.bio ?? existing?.bio,
    bankName: req.body.bankName ?? existing?.bankName,
    bankCode: req.body.bankCode ?? existing?.bankCode,
    accountNumber: req.body.accountNumber ?? existing?.accountNumber,
    accountName: req.body.accountName ?? existing?.accountName,
    isPayoutReady: existing?.isPayoutReady ?? false,
    approvalStatus: nextApprovalStatus,
    paystackRecipientCode: existing?.paystackRecipientCode,
    agreedToTerms: req.body.agreedToTerms ?? existing?.agreedToTerms ?? false,
    submittedAt: existing?.submittedAt,
  }

  await user.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Organizer profile updated',
    body: sanitizeUser(user.toObject()),
  })
})

const REQUIRED_FOR_SUBMISSION: { field: keyof IOrganizerProfile; label: string }[] = [
  { field: 'businessName', label: 'Organization name' },
  { field: 'category', label: 'Category' },
  { field: 'city', label: 'City' },
  { field: 'contactPhone', label: 'Contact phone' },
  { field: 'publicEmail', label: 'Public email' },
  { field: 'bio', label: 'Short bio' },
]

/**
 * Step 3 of the wizard ("Review & submit"). Bank details are deliberately
 * NOT required here — the Figma lets organizers skip that step and add it
 * later from settings; only free events need it to go live, per
 * event.controller.ts's paid-event gate.
 */
export const submitOrganizerProfileForReview = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId)
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  const profile = user.organizerProfile
  const missing = REQUIRED_FOR_SUBMISSION.filter(({ field }) => !profile?.[field]).map(({ label }) => label)
  if (missing.length > 0) {
    return sendTsRestError(res, 400, `Finish these before submitting: ${missing.join(', ')}`)
  }

  if (!req.body.agreedToTerms && !profile!.agreedToTerms) {
    return sendTsRestError(res, 400, 'You must agree to the Organizer Terms and Payout Policy')
  }

  user.role = 'organizer'
  user.organizerProfile!.agreedToTerms = true
  user.organizerProfile!.approvalStatus = 'pending'
  user.organizerProfile!.submittedAt = new Date()
  await user.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Submitted for review',
    body: sanitizeUser(user.toObject()),
  })
})

export const getOrganizerProfile = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId).lean()
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Organizer profile fetched',
    body: user.organizerProfile ?? null,
  })
})

// Paystack's bank list is effectively static — cache it in-process for a
// day instead of round-tripping to Paystack every time the bank dropdown
// renders. A restart just refetches once.
let bankListCache: { banks: { name: string; code: string }[]; fetchedAt: number } | null = null
const BANK_LIST_TTL_MS = 24 * 60 * 60 * 1000

export const listBanks = tryCatchWrapper(async (_req: Request, res: Response) => {
  if (!bankListCache || Date.now() - bankListCache.fetchedAt > BANK_LIST_TTL_MS) {
    const banks = await PaystackService.listBanks()
    bankListCache = { banks, fetchedAt: Date.now() }
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Banks fetched',
    body: bankListCache.banks,
  })
})

// Confirms the account holder's name for the "Where should we send your
// money?" step — the form fills Account Holder Name from this response
// rather than letting the organizer type it themselves, so we know the
// bank account genuinely belongs to whoever's claiming it.
export const resolveBankAccount = tryCatchWrapper(async (req: Request, res: Response) => {
  const { accountNumber, bankCode } = req.body

  try {
    const { accountName } = await PaystackService.resolveAccount({ accountNumber, bankCode })
    return sendTsRestSuccess(res, 200, {
      success: true,
      message: 'Account resolved',
      body: { accountName },
    })
  } catch (error: any) {
    return sendTsRestError(res, 400, error.message || 'Could not verify this account number')
  }
})

export const listOrganizerPayouts = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)

  const eventIds = await Event.find({ organizer: req.session.userId }).distinct('_id')
  const filter = { event: { $in: eventIds }, status: { $in: ['paid', 'partially_refunded'] } }

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .select('event organizerEarnings payoutStatus payoutAt createdAt')
      .populate('event', 'title slug startDate')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
  ])

  const totals = await Order.aggregate([
    { $match: filter },
    { $group: { _id: '$payoutStatus', amount: { $sum: '$organizerEarnings' } } },
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Payouts fetched',
    body: {
      orders,
      meta: buildPaginationMeta(page, limit, total),
      totalsByStatus: totals.reduce((acc, t) => ({ ...acc, [t._id]: t.amount }), {} as Record<string, number>),
    },
  })
})
