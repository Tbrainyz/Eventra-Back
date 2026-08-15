import logger from '../config/logger.js'
import Event from '../models/event.js'
import Ticket from '../models/ticket.js'
import User from '../models/user.js'
import { EmailService } from '../services/email.service.js'

const dateLabelFor = (date: Date): string => date.toLocaleDateString('en-NG', { dateStyle: 'medium' })

/**
 * Opt-in daily digest — organizerNotificationPreferences.dailySalesSummary,
 * the "Daily sales summary" toggle on Settings (defaults to off, like the
 * other organizer notification toggles). Called once a day by a Vercel
 * Cron Job, same pattern as promotionExpiryCron.
 *
 * Only emails organizers who actually sold/RSVP'd something in the last
 * 24h — an empty "you sold 0 tickets" digest every single day isn't useful
 * and is exactly the kind of email that gets a notification toggled back off.
 */
export const sendDailySalesSummaries = async (): Promise<{ organizersChecked: number; emailsSent: number }> => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const now = new Date()

  const organizers = await User.find({
    role: 'organizer',
    'organizerNotificationPreferences.dailySalesSummary': true,
  }).select('fullname email')

  let emailsSent = 0

  for (const organizer of organizers) {
    try {
      const events = await Event.find({ organizer: organizer._id }).select('title').lean()
      if (events.length === 0) continue
      const eventIds = events.map(event => event._id)
      const titleById = new Map(events.map(event => [String(event._id), event.title]))

      const perEvent = await Ticket.aggregate([
        {
          $match: {
            event: { $in: eventIds },
            createdAt: { $gte: since, $lte: now },
            status: { $ne: 'cancelled' },
          },
        },
        { $group: { _id: '$event', ticketsSold: { $sum: 1 }, revenue: { $sum: '$price' } } },
      ])

      if (perEvent.length === 0) continue

      const rows = perEvent
        .map(row => ({
          eventTitle: titleById.get(String(row._id)) ?? 'Untitled event',
          ticketsSold: row.ticketsSold as number,
          revenueLabel: row.revenue > 0 ? `₦${(row.revenue as number).toLocaleString('en-NG')}` : 'Free RSVP',
        }))
        .sort((a, b) => b.ticketsSold - a.ticketsSold)

      const totalRevenue = perEvent.reduce((sum, row) => sum + (row.revenue as number), 0)
      const totalRevenueLabel = totalRevenue > 0 ? `₦${totalRevenue.toLocaleString('en-NG')}` : 'Free RSVPs only'

      await EmailService.sendDailySalesSummaryEmail(organizer, dateLabelFor(now), rows, totalRevenueLabel)
      emailsSent++
    } catch (error: any) {
      logger.error({ err: error }, `Daily sales summary failed for organizer ${organizer._id}: ${error.message}`)
    }
  }

  logger.info({ organizersChecked: organizers.length, emailsSent }, 'Daily sales summary cron: batch complete')
  return { organizersChecked: organizers.length, emailsSent }
}
