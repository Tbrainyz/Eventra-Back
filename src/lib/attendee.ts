import type { Request } from 'express'
import User from '../models/user.js'
import type { ITicket } from '../models/ticket.js'

/**
 * The minimum identity info needed to issue a ticket or reservation —
 * deliberately smaller than IUser so a guest (who has no User document at
 * all) fits the same shape as a logged-in attendee. `userId` is the only
 * field that distinguishes the two; everything downstream (ticket.service,
 * email confirmation, etc.) just needs fullname + email and doesn't care
 * which case it's in.
 */
export interface AttendeeInfo {
  userId?: string
  fullname: string
  email: string
  phone?: string
}

/**
 * Resolves who's actually making this request — a logged-in user (session
 * wins if present), or guest contact details supplied in the request body.
 * Returns null when neither is available, which callers should treat as a
 * 400 ("provide your name and email to continue without an account").
 *
 * Used by rsvpFreeEvent and initializeCheckout — the two endpoints that
 * deliberately don't require verifySession, so they need this manual check
 * instead of the middleware doing it for them.
 */
export async function resolveAttendeeInfo(
  req: Request,
  guest: { guestName?: string; guestEmail?: string; guestPhone?: string }
): Promise<AttendeeInfo | null> {
  if (req.session?.userId) {
    const user = await User.findById(req.session.userId)
    if (!user) return null
    return { userId: user._id.toString(), fullname: user.fullname, email: user.email, phone: user.phone }
  }

  if (guest.guestName && guest.guestEmail) {
    return {
      fullname: guest.guestName.trim(),
      email: guest.guestEmail.trim().toLowerCase(),
      phone: guest.guestPhone?.trim(),
    }
  }

  return null
}

/**
 * A logged-in user can only touch their own tickets (attendee match), and a
 * guest can only touch tickets under the email they've proven ownership of
 * via the OTP flow (req.session.guestEmail — see verifyGuestTicketAccess).
 * Used by cancelReservation, requestRefund, and getTicketQrCode so a bare
 * ticketId alone is never enough to act on someone else's ticket.
 */
export function ticketBelongsToRequester(req: Request, ticket: Pick<ITicket, 'attendee' | 'attendeeEmail'>): boolean {
  if (req.session?.userId && ticket.attendee?.toString() === req.session.userId) return true
  if (req.session?.guestEmail && ticket.attendeeEmail === req.session.guestEmail) return true
  return false
}
