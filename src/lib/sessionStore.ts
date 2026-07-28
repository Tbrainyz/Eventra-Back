import mongoose from 'mongoose'
import logger from '../config/logger.js'

/**
 * Destroys every active session belonging to a user, straight out of the
 * connect-mongo `sessions` collection. Used when an admin suspends an
 * account, so the suspension takes effect immediately instead of waiting
 * for the session to naturally expire.
 * Our session data always stores `userId` as a string (see auth.controller.ts),
 * so this matches connect-mongo's stored `session.userId` field directly.
 */
export const invalidateUserSessions = async (userId: string): Promise<void> => {
  try {
    const db = mongoose.connection.db
    if (!db) {
      logger.error('invalidateUserSessions: no active mongoose connection')
      return
    }
    await db.collection('sessions').deleteMany({ 'session.userId': userId })
  } catch (error) {
    // Never let a session-cleanup failure block the suspension itself.
    logger.error({ err: error }, `invalidateUserSessions: failed to clear sessions for user ${userId}`)
  }
}
