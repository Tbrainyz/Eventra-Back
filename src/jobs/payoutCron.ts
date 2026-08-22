import logger from '../config/logger.js'
import Order from '../models/order.js'
import User from '../models/user.js'
import { PaystackService } from '../services/paystack.service.js'

// Funds are held until a few days after the event, per the PRD.
const PAYOUT_DELAY_DAYS = 3

/**
 * Initiates the actual Paystack transfer for one paid order and flips it to
 * 'processing' (payment.controller.ts's webhook is what moves it to 'paid'
 * once Paystack confirms with a transfer.success event). Pulled out of
 * processDuePayouts so admin.controller.ts's manual "Release" action can
 * run the exact same transfer path instead of a second, possibly-diverging
 * copy of this logic — the only difference between the cron and a manual
 * release is which orders get selected, not what happens to each one.
 */
export async function initiateOrderPayout(order: {
  _id: any
  organizerEarnings: number
  eventDoc: { _id: any; organizer: any; title?: string }
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const organizer = await User.findById(order.eventDoc.organizer)
  const recipientCode = organizer?.organizerProfile?.paystackRecipientCode

  if (!organizer || !recipientCode) {
    return { ok: false, reason: 'Organizer has no Paystack recipient on file' }
  }

  try {
    await PaystackService.initiateTransfer({
      amountKobo: Math.round(order.organizerEarnings * 100),
      recipientCode,
      reason: `Eventra payout — ${order.eventDoc.title ?? 'event'}`,
      reference: `PAYOUT-${order._id}`,
    })

    await Order.updateOne({ _id: order._id }, { $set: { payoutStatus: 'processing' } })
    return { ok: true }
  } catch (error: any) {
    return { ok: false, reason: error.message || 'Transfer failed' }
  }
}

/**
 * Finds paid orders for events that happened at least PAYOUT_DELAY_DAYS ago
 * and initiates a Paystack transfer to the organizer for each.
 * Called by a scheduled cron job, same pattern as the email cron.
 */
export const processDuePayouts = async (): Promise<{ processed: number; initiated: number; skipped: number }> => {
  let initiated = 0
  let skipped = 0

  const cutoff = new Date(Date.now() - PAYOUT_DELAY_DAYS * 24 * 60 * 60 * 1000)

  const dueOrders = await Order.aggregate([
    { $match: { status: 'paid', payoutStatus: 'pending' } },
    { $lookup: { from: 'events', localField: 'event', foreignField: '_id', as: 'eventDoc' } },
    { $unwind: '$eventDoc' },
    { $match: { 'eventDoc.startDate': { $lte: cutoff } } },
    { $limit: 25 },
  ])

  if (dueOrders.length === 0) {
    logger.info('Payout cron: no payouts due')
    return { processed: 0, initiated: 0, skipped: 0 }
  }

  for (const order of dueOrders) {
    const result = await initiateOrderPayout(order)
    if (result.ok) {
      initiated++
    } else {
      logger.error(`Payout cron: ${result.reason} — skipping order ${order._id}`)
      skipped++
    }
  }

  logger.info({ initiated, skipped }, 'Payout cron: batch complete')
  return { processed: dueOrders.length, initiated, skipped }
}
