import { IEvent } from '../models/event.js'

export type EventDisplayStatus = 'draft' | 'pending_approval' | 'rejected' | 'cancelled' | 'postponed' | 'sold_out' | 'live' | 'past'

/**
 * Maps an event's raw `status` (the approval/moderation state) plus its
 * dates and sold count onto the label the dashboard actually shows
 * ("LIVE" / "Sold out" / "Past" / "Draft" etc — see the Recent events
 * table in the Overview design). Only 'approved' events can become
 * 'sold_out' / 'live' / 'past' — everything else just surfaces its raw
 * status, since e.g. a draft or rejected event was never on sale.
 */
export function deriveEventDisplayStatus(event: Pick<IEvent, 'status' | 'startDate' | 'endDate' | 'capacity' | 'ticketsSoldCount' | 'reservationsCount' | 'type'>): EventDisplayStatus {
  if (event.status !== 'approved') {
    return event.status as EventDisplayStatus
  }

  const soldCount = event.type === 'free' ? event.reservationsCount : event.ticketsSoldCount
  if (event.capacity && soldCount >= event.capacity) {
    return 'sold_out'
  }

  const endsAt = event.endDate ?? event.startDate
  if (endsAt.getTime() < Date.now()) {
    return 'past'
  }

  return 'live'
}
