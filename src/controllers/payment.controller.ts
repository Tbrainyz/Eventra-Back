import crypto from 'crypto'
import { Request, Response } from 'express'
import { env } from '../config/keys.js'
import logger from '../config/logger.js'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import Event from '../models/event.js'
import Order from '../models/order.js'
import User from '../models/user.js'
import { PaystackService } from '../services/paystack.service.js'
import { TicketService } from '../services/ticket.service.js'
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

const handleTicketOrderPayment = async (reference: string): Promise<void> => {
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

const handlePromotionPayment = async (reference: string): Promise<void> => {
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

  // Payment confirmed, but it still awaits admin approval before going live.
  event.promotion.paidAt = new Date()
  await event.save()
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
  }
  // Anything else is acknowledged and ignored, so Paystack doesn't retry forever.

  return sendTsRestSuccess<undefined>(res, 200, { success: true, message: 'Webhook processed' })
})
