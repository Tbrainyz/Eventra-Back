import crypto from 'crypto'
import { Request, Response } from 'express'
import { env } from '../config/keys.js'
import { getPromotionPackage } from '../config/promotionPackages.js'
import logger from '../config/logger.js'
import { getPlatformSettings } from '../lib/platformSettings.js'
import { notifyAdmins } from '../lib/notify.js'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import Event from '../models/event.js'
import Order from '../models/order.js'
import Dispute from '../models/dispute.js'
import User from '../models/user.js'
import { PaystackService } from '../services/paystack.service.js'
import { TicketService } from '../services/ticket.service.js'
import { EmailService } from '../services/email.service.js'
import type { AttendeeInfo } from '../lib/attendee.js'

/**
 * Verifies the `x-paystack-signature` header against the raw request body.
 * Paystack docs: HMAC SHA512 of the raw payload, keyed with the secret key.
 */
const isValidPaystackSignature = (req: Request): boolean => {
  const signature = req.headers['x-paystack-signature']
  if (!signature || !req.rawBody) return false

  const hash = crypto.createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(req.rawBody).digest('hex')

  return hash === signature
}

/**
 * Re-verifies a ticket-order payment directly against Paystack and, if
 * confirmed, issues tickets — idempotent (safe to call repeatedly for the
 * same reference). This is the single source of truth for "did this order
 * get paid", used by both:
 *  - the Paystack webhook (paystackWebhook below), which is how this is
 *    *supposed* to fire — near-instant, server-to-server
 *  - getOrderByReference (ticket.controller.ts), as a fallback — webhooks
 *    require Paystack's servers to be able to reach ours, which fails
 *    silently in local dev (localhost isn't publicly reachable) or if the
 *    webhook URL in the Paystack dashboard is stale/unset. Without a
 *    fallback, the order just sits 'pending' forever even though Paystack
 *    already confirmed the charge — which is exactly what polling the
 *    checkout-callback page against a never-updating order looks like.
 */
export const handleTicketOrderPayment = async (reference: string): Promise<void> => {
  const order = await Order.findOne({ paystackReference: reference })
  if (!order) {
    logger.error(`Paystack webhook: no order found for reference ${reference}`)
    return
  }

  // Idempotency: webhooks can be delivered more than once. If we've already
  // issued tickets for this order, do nothing further.
  if (order.status === 'paid') return

  // Never trust the webhook body alone — re-verify directly against Paystack.
  const verification = await PaystackService.verifyTransaction(reference)

  const expectedKobo = Math.round(order.total * 100)
  if (verification.status !== 'success' || verification.amountKobo !== expectedKobo) {
    order.status = 'failed'
    await order.save()
    logger.error(`Paystack webhook: verification mismatch for reference ${reference}`)
    return
  }

  let attendee: AttendeeInfo
  if (order.buyer) {
    const buyer = await User.findById(order.buyer)
    if (!buyer) {
      logger.error(`Paystack webhook: buyer not found for order ${order._id}`)
      return
    }
    attendee = { userId: buyer._id.toString(), fullname: buyer.fullname, email: buyer.email, phone: buyer.phone }
  } else if (order.guestEmail && order.guestName) {
    attendee = { fullname: order.guestName, email: order.guestEmail, phone: order.guestPhone }
  } else {
    logger.error(`Paystack webhook: order ${order._id} has neither a buyer nor guest contact details`)
    return
  }

  try {
    await TicketService.issueTicketsForPaidOrder(order, attendee)
  } catch (error: any) {
    // Stock ran out between checkout and payment confirmation — mark for a refund,
    // an admin/organizer must resolve this manually per the PRD's refund process.
    order.status = 'failed'
    await order.save()
    logger.error(`Paystack webhook: ticket issuance failed for order ${order._id}: ${error.message}`)
  }
}

export const handlePromotionPayment = async (reference: string): Promise<void> => {
  const event = await Event.findOne({ 'promotion.paystackReference': reference })
  if (!event || !event.promotion) {
    logger.error(`Paystack webhook: no event found for promotion reference ${reference}`)
    return
  }
  if (event.promotion.paidAt) return // already confirmed

  const verification = await PaystackService.verifyTransaction(reference)
  if (verification.status !== 'success') {
    logger.error(`Paystack webhook: promotion payment verification failed for ${reference}`)
    return
  }

  // Payment confirmed, but it still awaits admin approval before going live
  // — unless the platform's auto-approve-promotions setting is on, in
  // which case it's live immediately. Same duration math as
  // approveEventPromotion in admin.controller.ts, kept in sync deliberately
  // since this is the auto-approve path for the exact same transition.
  event.promotion.paidAt = new Date()
  const settings = await getPlatformSettings()
  if (settings.autoApprovePromotions) {
    const pkg = getPromotionPackage(event.promotion.package)
    const durationDays = pkg?.durationDays ?? 7
    const startsAt = new Date()
    event.promotion.status = 'approved'
    event.promotion.startsAt = startsAt
    event.promotion.endsAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000)
    event.isPromoted = true
  } else {
    await notifyAdmins({
      type: 'promotion_submitted',
      title: 'New promotion awaiting review',
      message: `A promotion request for "${event.title || 'an event'}" has been paid and needs approval.`,
      link: `/admin/events/${event._id}`,
    })
  }
  await event.save()
}

/**
 * Ingests both dispute lifecycle events Paystack sends. `charge.dispute.create`
 * is the one that matters for creating our row; `charge.dispute.resolve`
 * just syncs the final outcome (whether resolved by us via
 * challengeDispute/acceptDisputeLoss, by Paystack's 16-hour auto-accept, or
 * by Paystack's own investigation) — same idempotent upsert either way,
 * keyed on Paystack's own dispute id so a re-delivered webhook never
 * creates a duplicate row.
 */
const handleDisputeEvent = async (event: string, data: any): Promise<void> => {
  const paystackDisputeId = String(data.id)
  const transactionReference: string | undefined = data.transaction?.reference

  const order = transactionReference ? await Order.findOne({ paystackReference: transactionReference }) : null
  if (!order) {
    logger.error(`Paystack webhook: dispute ${paystackDisputeId} has no matching order for reference ${transactionReference}`)
    return
  }

  await Dispute.findOneAndUpdate(
    { paystackDisputeId },
    {
      paystackDisputeId,
      order: order._id,
      event: order.event,
      amount: order.subtotal,
      status: data.status,
      resolution: data.resolution ?? undefined,
      raisedAt: data.createdAt ?? new Date(),
      resolvedAt: data.status === 'resolved' ? new Date() : undefined,
    },
    { upsert: true, new: true }
  )

  if (event === 'charge.dispute.create') {
    await notifyAdmins({
      type: 'dispute_created',
      title: 'New payment dispute',
      message: `A chargeback for ₦${order.subtotal.toLocaleString('en-NG')} was raised on order ${order._id}.`,
      link: '/admin/refunds',
    })
  }
}

const handleTransferOutcome = async (event: string, reference: string): Promise<void> => {
  // Our payout references are formatted PAYOUT-<orderId>
  const orderId = reference.replace(/^PAYOUT-/, '')
  const order = await Order.findById(orderId)
  if (!order) {
    logger.error(`Paystack webhook: no order found for payout reference ${reference}`)
    return
  }

  if (event === 'transfer.success') {
    order.payoutStatus = 'paid'
    order.payoutAt = new Date()
    await order.save()

    const eventDoc = await Event.findById(order.event).select('title organizer')
    if (eventDoc) {
      const organizer = await User.findById(eventDoc.organizer)
      // Opt-in — defaults to off, see organizerNotificationPreferences on
      // the User model and the "Payout confirmations" toggle on Settings.
      if (organizer && organizer.organizerNotificationPreferences?.payoutConfirmations) {
        EmailService.sendPayoutConfirmationEmail(organizer, eventDoc.title, `₦${order.organizerEarnings.toLocaleString('en-NG')}`).catch(
          error => logger.error({ err: error }, `Payout-confirmation email failed for order ${order._id}`)
        )
      }
    }
  } else {
    // transfer.failed / transfer.reversed — leave it for the next payout cron run to retry.
    order.payoutStatus = 'pending'
    await order.save()
    logger.error(`Paystack webhook: transfer ${event} for order ${order._id}`)
  }
}

export const paystackWebhook = tryCatchWrapper(async (req: Request, res: Response) => {
  if (!isValidPaystackSignature(req)) {
    logger.warn('Rejected Paystack webhook with invalid signature')
    return sendTsRestError(res, 401, 'Invalid signature')
  }

  const { event, data } = req.body
  const reference: string | undefined = data?.reference

  if (event === 'charge.success' && reference?.startsWith('PROMO-')) {
    await handlePromotionPayment(reference)
  } else if (event === 'charge.success' && reference) {
    await handleTicketOrderPayment(reference)
  } else if ((event === 'transfer.success' || event === 'transfer.failed' || event === 'transfer.reversed') && reference) {
    await handleTransferOutcome(event, reference)
  } else if (event === 'charge.dispute.create' || event === 'charge.dispute.resolve') {
    await handleDisputeEvent(event, data)
  }
  // Anything else is acknowledged and ignored, so Paystack doesn't retry forever.

  return sendTsRestSuccess<undefined>(res, 200, { success: true, message: 'Webhook processed' })
})
