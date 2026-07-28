import logger from '../config/logger.js'
import Order from '../models/order.js'
import User from '../models/user.js'
import { PaystackService } from '../services/paystack.service.js'

// Funds are held until a few days after the event, per the PRD.
const PAYOUT_DELAY_DAYS = 3

/**
 * Finds paid orders for events that happened at least PAYOUT_DELAY_DAYS ago
 * and initiates a Paystack transfer to the organizer for each.
 * A transfer is only "processing" here — payment.controller.ts's webhook
 * flips it to 'paid' once Paystack confirms with a transfer.success event.
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
    try {
      const organizer = await User.findById(order.eventDoc.organizer)
      const recipientCode = organizer?.organizerProfile?.paystackRecipientCode

      if (!organizer || !recipientCode) {
        logger.error(`Payout cron: organizer ${order.eventDoc.organizer} has no Paystack recipient — skipping order ${order._id}`)
        skipped++
        continue
      }

      await PaystackService.initiateTransfer({
        amountKobo: Math.round(order.organizerEarnings * 100),
        recipientCode,
        reason: `Eventra payout — ${order.eventDoc.title}`,
        reference: `PAYOUT-${order._id}`,
      })

      await Order.updateOne({ _id: order._id }, { $set: { payoutStatus: 'processing' } })
      initiated++
    } catch (error: any) {
      logger.error({ err: error }, `Payout cron: transfer failed for order ${order._id}: ${error.message}`)
      skipped++
    }
  }

  logger.info({ initiated, skipped }, 'Payout cron: batch complete')
  return { processed: dueOrders.length, initiated, skipped }
}
