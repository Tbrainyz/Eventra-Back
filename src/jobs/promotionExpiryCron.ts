import logger from '../config/logger.js'
import Event from '../models/event.js'

/**
 * Un-features events whose approved promotion window has ended.
 * Called by a scheduled cron job, same pattern as the email cron.
 */
export const expirePromotions = async (): Promise<{ expired: number }> => {
  const result = await Event.updateMany(
    { isPromoted: true, 'promotion.endsAt': { $lte: new Date() } },
    { $set: { isPromoted: false } }
  )

  logger.info({ expired: result.modifiedCount }, 'Promotion expiry cron: batch complete')
  return { expired: result.modifiedCount }
}
