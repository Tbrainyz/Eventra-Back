import type { NextFunction, Request, Response } from 'express'
import { sendTsRestError } from '../lib/responseHandler.js'

/**
 * Requires an active logged-in session (any role).
 */
export const verifySession = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.session?.userId) {
    sendTsRestError(res, 401, 'Unauthorized: please log in to continue')
    return
  }
  next()
}

/**
 * Requires the logged-in user to be an admin.
 * Assumes verifySession has already run, but checks session presence too.
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.session?.userId) {
    sendTsRestError(res, 401, 'Unauthorized: please log in to continue')
    return
  }
  if (req.session.role !== 'admin') {
    sendTsRestError(res, 403, 'Forbidden: admin access only')
    return
  }
  next()
}

/**
 * Requires the logged-in user's role to be one of the allowed roles.
 * Usage: requireRole('organizer', 'admin')
 */
export const requireRole = (...roles: Array<'attendee' | 'organizer' | 'admin'>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.session?.userId) {
      sendTsRestError(res, 401, 'Unauthorized: please log in to continue')
      return
    }
    if (!req.session.role || !roles.includes(req.session.role)) {
      sendTsRestError(res, 403, `Forbidden: requires one of the following roles: ${roles.join(', ')}`)
      return
    }
    next()
  }
}
