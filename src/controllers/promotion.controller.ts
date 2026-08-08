import { randomUUID } from 'crypto'
import { Request, Response } from 'express'
import { env } from '../config/keys.js'
import { getPromotionPackage, PROMOTION_PACKAGES } from '../config/promotionPackages.js'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import Event from '../models/event.js'
import User from '../models/user.js'
import { PaystackService } from '../services/paystack.service.js'

const NAIRA_TO_KOBO = 100

export const listPromotionPackages = tryCatchWrapper(async (req: Request, res: Response) => {
  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Promotion packages fetched',
    body: PROMOTION_PACKAGES,
  })
})

const PROMOTION_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending review',
  approved: 'Active',
  rejected: 'Rejected',
  expired: 'Expired',
}

/**
 * Powers the "Your Promotion" table on the Promotions page — every event
 * belonging to this organizer that has (or has had) a promotion attached.
 * Each event only ever holds one `promotion` record at a time (see
 * IEventPromotion on the Event model), so this is one row per event, most
 * recent first — not a full history of past promotion requests.
 */
export const listMyPromotions = tryCatchWrapper(async (req: Request, res: Response) => {
  const events = await Event.find({ organizer: req.session.userId, promotion: { $exists: true } })
    .select('title promotion')
    .sort({ 'promotion.paidAt': -1, 'promotion.startsAt': -1 })
    .lean()

  const now = new Date()

  const promotions = events.map(event => {
    const promotion = event.promotion!
    const pkg = getPromotionPackage(promotion.package)
    const isExpired = promotion.status === 'approved' && !!promotion.endsAt && new Date(promotion.endsAt) < now
    const statusKey = isExpired ? 'expired' : promotion.status

    return {
      eventId: event._id,
      eventTitle: event.title,
      packageId: promotion.package,
      packageLabel: pkg?.label ?? promotion.package,
      placementLabel: pkg?.placementLabel,
      priceNaira: pkg?.priceNaira ?? null,
      startsAt: promotion.startsAt ?? null,
      endsAt: promotion.endsAt ?? null,
      status: statusKey,
      statusLabel: PROMOTION_STATUS_LABEL[statusKey] ?? statusKey,
      paystackReference: promotion.paystackReference,
      paid: Boolean(promotion.paidAt),
    }
  })

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Promotions fetched',
    body: promotions,
  })
})

/**
 * Organizer requests to promote their (already-approved) event. Payment is
 * collected first; an admin still has to approve the promotion afterwards
 * before it actually goes live (see admin.controller.ts).
 */
export const requestPromotion = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const { packageId } = req.body as { packageId: string }

  const pkg = getPromotionPackage(packageId)
  if (!pkg) {
    return sendTsRestError(res, 400, 'Unknown promotion package')
  }

  const event = await Event.findOne({ _id: id, organizer: req.session.userId })
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (event.status !== 'approved') {
    return sendTsRestError(res, 400, 'Only a live approved event can be promoted')
  }
  if (event.promotion && event.promotion.status === 'pending') {
    return sendTsRestError(res, 409, 'A promotion request is already pending for this event')
  }

  const organizer = await User.findById(req.session.userId)
  if (!organizer) {
    return sendTsRestError(res, 404, 'User not found')
  }

  const reference = `PROMO-${event._id.toString().slice(-6)}-${randomUUID()}`

  try {
    const paystackTx = await PaystackService.initializeTransaction({
      email: organizer.email,
      amountKobo: pkg.priceNaira * NAIRA_TO_KOBO,
      reference,
      callbackUrl: `${env.CLIENT_URL}/organizer/promotions/callback`,
      metadata: { eventId: event._id.toString(), packageId: pkg.id },
    })

    event.promotion = { package: pkg.id, status: 'pending', paystackReference: reference }
    await event.save()

    return sendTsRestSuccess(res, 201, {
      success: true,
      message: 'Promotion checkout initialized',
      body: { authorizationUrl: paystackTx.authorizationUrl, reference },
    })
  } catch (error: any) {
    return sendTsRestError(res, 502, error.message || 'Could not start payment with Paystack')
  }
})
