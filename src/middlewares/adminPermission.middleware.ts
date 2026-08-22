import type { NextFunction, Request, Response } from 'express'
import { sendTsRestError } from '../lib/responseHandler.js'

export type AdminTier = 'owner' | 'admin' | 'support'

/**
 * Second gate after requireAdmin — that one only checks role === 'admin',
 * this one checks *which kind* of admin. Three tiers, each a superset of
 * the one below it in day-to-day access, with two carve-outs that are
 * Owner-only regardless:
 *   - Settings (commission rate, currency, auto-approve toggles,
 *     maintenance mode) — platform-wide financial/operational levers.
 *   - Managing other admins' roles and inviting new admins — a support
 *     rep or regular admin escalating their own or a peer's access would
 *     be a real privilege-escalation hole.
 *
 * 'support' can do routine moderation (approve/reject events, organizers,
 * promotions, refunds; dismiss flags) but not the higher-stakes actions:
 * releasing a payout early, removing an event outright, or suspending an
 * account. Those need 'admin' or 'owner'.
 *
 * req.session.adminRole is set at login (see auth.controller.ts) and only
 * refreshed on next login — updateAdminRole in admin.controller.ts
 * invalidates the affected admin's sessions when their tier changes, the
 * same way suspendUser already forces a re-login, so a stale tier here
 * never outlives the change for longer than "until they're forced to log
 * back in."  A missing adminRole (accounts created before this feature
 * existed) is treated as 'admin', not locked out and not silently
 * elevated to 'owner'.
 */
export const requireAdminTier = (...allowed: AdminTier[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const tier: AdminTier = req.session.adminRole ?? 'admin'
    if (!allowed.includes(tier)) {
      sendTsRestError(res, 403, `Forbidden: requires one of the following admin tiers: ${allowed.join(', ')}`)
      return
    }
    next()
  }
}
