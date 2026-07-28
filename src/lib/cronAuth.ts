import { Request } from 'express'
import { env } from '../config/keys.js'

/**
 * Vercel Cron Jobs automatically send `Authorization: Bearer <CRON_SECRET>`
 * on every scheduled invocation when CRON_SECRET is set as an env var — that's
 * the real, documented mechanism (vercel.json has no way to set custom headers).
 * We also accept a manual `x-cron-secret` header for local/curl testing.
 */
export const isAuthorizedCronCall = (req: Request): boolean => {
  const authHeader = req.headers.authorization
  if (authHeader === `Bearer ${env.CRON_SECRET}`) return true

  const legacyHeader = req.headers['x-cron-secret']
  return !!legacyHeader && legacyHeader === env.CRON_SECRET
}
