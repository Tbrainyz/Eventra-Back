import type { IEvent, IRefundPolicy } from '../models/event.js'

export interface RefundEligibility {
  allowed: boolean
  reason?: string
}

/**
 * Decides whether a refund request should be allowed right now, given the
 * event's current status and stated refund policy. Pulled out of the
 * controller so this logic — the exact rule that determines whether an
 * attendee gets their money back — can be unit tested directly, without a
 * database, and reused anywhere else it's needed later (e.g. a pre-checkout
 * "refunds allowed until X" notice).
 */
export const checkRefundEligibility = (
  eventStatus: IEvent['status'],
  refundPolicy: IRefundPolicy | undefined,
  eventStartDate: Date,
  now: Date = new Date()
): RefundEligibility => {
  if (eventStatus === 'cancelled') {
    return { allowed: false, reason: 'This event was cancelled — refunds were issued automatically' }
  }

  // A postponed event always allows a refund request, regardless of the original policy.
  if (eventStatus === 'postponed') {
    return { allowed: true }
  }

  if (!refundPolicy || refundPolicy.type === 'no-refunds') {
    return { allowed: false, reason: 'This event does not allow refunds' }
  }

  if (refundPolicy.type === 'refund-until-days-before' && typeof refundPolicy.daysBefore === 'number') {
    const deadline = new Date(eventStartDate.getTime() - refundPolicy.daysBefore * 24 * 60 * 60 * 1000)
    if (now.getTime() > deadline.getTime()) {
      return { allowed: false, reason: 'The refund window for this event has passed' }
    }
  }

  return { allowed: true }
}
