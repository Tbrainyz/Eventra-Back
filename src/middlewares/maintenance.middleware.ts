import { NextFunction, Request, Response } from 'express'
import { getPlatformSettings } from '../lib/platformSettings.js'

// Always reachable even while maintenanceMode is on — health checks need
// to keep working, auth needs to stay open so an admin can actually log in
// to turn maintenance mode back off, and admin routes need to stay open
// for that same reason (and so an already-logged-in admin can keep
// working while everyone else is locked out).
const ALWAYS_ALLOWED_PREFIXES = ['/health', '/api/v1/auth', '/api/v1/admin']

/**
 * Gates every other route behind a 503 when Settings > Maintenance mode is
 * on. Mounted once, early, in index.ts — checked per-request but backed by
 * lib/platformSettings.ts's cache, so this isn't a DB round trip on every
 * single request.
 */
export async function maintenanceGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (ALWAYS_ALLOWED_PREFIXES.some(prefix => req.path.startsWith(prefix))) {
    return next()
  }
  if (req.session?.role === 'admin') {
    return next()
  }

  const settings = await getPlatformSettings()
  if (!settings.maintenanceMode) {
    return next()
  }

  res.status(503).json({
    success: false,
    message: "Eventra is down for maintenance right now — we'll be back shortly.",
  })
}
