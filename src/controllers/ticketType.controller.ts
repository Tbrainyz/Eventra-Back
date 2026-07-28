import { Request, Response } from 'express'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import Event from '../models/event.js'
import TicketType from '../models/ticketType.js'

/**
 * Confirms the event exists, belongs to the caller, and is a paid event.
 * Ticket types only make sense on paid events (free events use Event.capacity).
 */
const getOwnedPaidEvent = async (eventId: string, organizerId: string) => {
  const event = await Event.findOne({ _id: eventId, organizer: organizerId })
  if (!event) return { event: null, error: 'Event not found' }
  if (event.type !== 'paid') return { event: null, error: 'Ticket types only apply to paid events' }
  return { event, error: null }
}

/**
 * Recomputes Event.minPrice from the cheapest active ticket type. Call this
 * after any ticket type create/update — it's what keeps Explore's price
 * filter/sort accurate without joining to TicketType on every browse request.
 */
const syncEventMinPrice = async (eventId: string) => {
  const cheapest = await TicketType.findOne({ event: eventId, isActive: true }).sort({ price: 1 }).select('price').lean()
  await Event.updateOne({ _id: eventId }, { $set: { minPrice: cheapest?.price ?? 0 } })
}

export const createTicketType = tryCatchWrapper(async (req: Request, res: Response) => {
  const { eventId } = req.params
  const { event, error } = await getOwnedPaidEvent(eventId as string, req.session.userId!)
  if (!event) {
    return sendTsRestError(res, 404, error!)
  }

  const ticketType = await TicketType.create({ ...req.body, event: event._id })
  await syncEventMinPrice(event._id.toString())

  return sendTsRestSuccess(res, 201, {
    success: true,
    message: 'Ticket type created',
    body: ticketType.toObject(),
  })
})

export const listTicketTypesForOrganizer = tryCatchWrapper(async (req: Request, res: Response) => {
  const { eventId } = req.params
  const { event, error } = await getOwnedPaidEvent(eventId as string, req.session.userId!)
  if (!event) {
    return sendTsRestError(res, 404, error!)
  }

  const ticketTypes = await TicketType.find({ event: event._id }).sort({ createdAt: 1 }).lean()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Ticket types fetched',
    body: ticketTypes,
  })
})

export const updateTicketType = tryCatchWrapper(async (req: Request, res: Response) => {
  const { eventId, ticketTypeId } = req.params
  const { event, error } = await getOwnedPaidEvent(eventId as string, req.session.userId!)
  if (!event) {
    return sendTsRestError(res, 404, error!)
  }

  const ticketType = await TicketType.findOne({ _id: ticketTypeId, event: event._id })
  if (!ticketType) {
    return sendTsRestError(res, 404, 'Ticket type not found')
  }

  if (typeof req.body.quantity === 'number' && req.body.quantity < ticketType.quantitySold) {
    return sendTsRestError(res, 400, `Quantity can't be lower than the ${ticketType.quantitySold} already sold`)
  }

  Object.assign(ticketType, req.body)
  await ticketType.save()
  await syncEventMinPrice(event._id.toString())

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Ticket type updated',
    body: ticketType.toObject(),
  })
})
