import { Request } from 'express'
import logger from '../config/logger.js'
import AuditLog from '../models/auditLog.js'
import User from '../models/user.js'

/**
 * Fire-and-forget: an audit entry failing to write should never fail the
 * admin action itself (same reasoning as CloudinaryService.deleteImage
 * cleanup calls elsewhere) — the action already succeeded by the time this
 * is called, so this is purely a record of it, not part of the transaction.
 */
export async function logAdminAction(req: Request, action: string, targetLabel: string): Promise<void> {
  try {
    const adminId = req.session?.userId
    if (!adminId) return

    const admin = await User.findById(adminId).select('fullname').lean()
    if (!admin) return

    await AuditLog.create({
      action,
      targetLabel,
      admin: adminId,
      adminName: admin.fullname,
    })
  } catch (error) {
    logger.error({ err: error }, `Failed to write audit log entry for "${action}"`)
  }
}
