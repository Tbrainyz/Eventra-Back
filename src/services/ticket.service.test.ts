import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import Event from '../models/event.js'
import Order from '../models/order.js'
import Ticket from '../models/ticket.js'
import TicketType from '../models/ticketType.js'
import User, { IUser } from '../models/user.js'
import Category from '../models/category.js'

// Ticket confirmation emails hit the network (Brevo) — stub them out for these tests.
vi.mock('./email.service.js', () => ({
  EmailService: {
    sendTicketConfirmationEmail: vi.fn().mockResolvedValue({ success: true }),
    // notifyOrganizerOfSale only calls this when the organizer has opted
    // in (newSalesRsvps), which no test fixture here does — stubbed
    // anyway so a future test that does opt in doesn't hit the network.
    sendNewSaleNotificationEmail: vi.fn().mockResolvedValue({ success: true }),
  },
}))

// Transactions require a replica set, hence MongoMemoryReplSet rather than the plain server.
let replSet: MongoMemoryReplSet

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    binary: { version: '7.0.14' },
  })
  await mongoose.connect(replSet.getUri(), { dbName: 'eventra_test' })
}, 60000)

afterAll(async () => {
  await mongoose.disconnect()
  await replSet.stop()
})

afterEach(async () => {
  await Promise.all([
    Event.deleteMany({}),
    TicketType.deleteMany({}),
    Ticket.deleteMany({}),
    Order.deleteMany({}),
    User.deleteMany({}),
    Category.deleteMany({}),
  ])
  vi.clearAllMocks()
})

const makeAttendee = async (overrides: Partial<any> = {}): Promise<IUser> => {
  return User.create({
    fullname: 'Test Attendee',
    email: `attendee-${new mongoose.Types.ObjectId()}@example.com`,
    password: 'password123',
    phone: '08000000000',
    role: 'attendee',
    isVerified: true,
    ...overrides,
  })
}

const makeFreeEvent = async (overrides: Partial<any> = {}) => {
  const category = await Category.create({ name: 'Music', slug: 'music' })
  const organizer = await makeAttendee({ role: 'organizer' })
  return Event.create({
    organizer: organizer._id,
    title: 'Free Test Event',
    slug: `free-test-${new mongoose.Types.ObjectId()}`,
    description: 'A free test event',
    category: category._id,
    type: 'free',
    venue: { name: 'Test Hall', address: '1 Test St', city: 'Lagos' },
    startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    status: 'approved',
    capacity: 2,
    ...overrides,
  })
}

describe('TicketService.rsvpToFreeEvent', () => {
  it('issues a ticket and increments reservationsCount', async () => {
    const { TicketService } = await import('./ticket.service.js')
    const event = await makeFreeEvent()
    const attendee = await makeAttendee()

    const tickets = await TicketService.rsvpToFreeEvent(event._id.toString(), attendee)

    expect(tickets).toHaveLength(1)
    expect(tickets[0].status).toBe('valid')
    expect(tickets[0].type).toBe('free')

    const updatedEvent = await Event.findById(event._id).lean()
    expect(updatedEvent!.reservationsCount).toBe(1)
  })

  // Regression test: rsvpToFreeEvent's guests>1 path calls Ticket.create()
  // with an array of documents inside a transaction session, which throws
  // "Cannot call `create()` with a session and multiple documents unless
  // `ordered: true` is set" unless that option is passed — every other
  // test here only ever requests 1 guest, so this path went unexercised
  // and the bug shipped. See ticket.service.ts's two Ticket.create() calls.
  it('issues one ticket per guest when reserving for multiple guests', async () => {
    const { TicketService } = await import('./ticket.service.js')
    const event = await makeFreeEvent({ capacity: 10 })
    const attendee = await makeAttendee()

    const tickets = await TicketService.rsvpToFreeEvent(event._id.toString(), attendee, 3)

    expect(tickets).toHaveLength(3)
    expect(new Set(tickets.map(t => t.code)).size).toBe(3) // each ticket gets its own unique code
    tickets.forEach(ticket => {
      expect(ticket.status).toBe('valid')
      expect(ticket.type).toBe('free')
    })

    const updatedEvent = await Event.findById(event._id).lean()
    expect(updatedEvent!.reservationsCount).toBe(3)
  })

  it('rejects a reservation once the event is at capacity', async () => {
    const { TicketService } = await import('./ticket.service.js')
    const event = await makeFreeEvent({ capacity: 1 })

    const firstAttendee = await makeAttendee()
    await TicketService.rsvpToFreeEvent(event._id.toString(), firstAttendee)

    const secondAttendee = await makeAttendee()
    await expect(TicketService.rsvpToFreeEvent(event._id.toString(), secondAttendee)).rejects.toThrow(/fully booked/i)
  })

  it('never overbooks capacity under concurrent requests (the race condition this atomic update exists to prevent)', async () => {
    const { TicketService } = await import('./ticket.service.js')
    const event = await makeFreeEvent({ capacity: 3 })
    const attendees = await Promise.all(Array.from({ length: 10 }, () => makeAttendee()))

    const results = await Promise.allSettled(
      attendees.map(attendee => TicketService.rsvpToFreeEvent(event._id.toString(), attendee))
    )

    const succeeded = results.filter(r => r.status === 'fulfilled')
    const failed = results.filter(r => r.status === 'rejected')

    expect(succeeded).toHaveLength(3)
    expect(failed).toHaveLength(7)

    const finalEvent = await Event.findById(event._id).lean()
    expect(finalEvent!.reservationsCount).toBe(3)

    const ticketCount = await Ticket.countDocuments({ event: event._id, status: 'valid' })
    expect(ticketCount).toBe(3)
  })
})

describe('TicketService.issueTicketsForPaidOrder', () => {
  const makePaidEventWithTicketType = async (quantity: number) => {
    const category = await Category.create({ name: 'Conference', slug: 'conference' })
    const organizer = await makeAttendee({ role: 'organizer' })
    const event = await Event.create({
      organizer: organizer._id,
      title: 'Paid Test Event',
      slug: `paid-test-${new mongoose.Types.ObjectId()}`,
      description: 'A paid test event',
      category: category._id,
      type: 'paid',
      venue: { name: 'Test Arena', address: '2 Test St', city: 'Lagos' },
      startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: 'approved',
    })
    const ticketType = await TicketType.create({
      event: event._id,
      name: 'Regular',
      price: 5000,
      quantity,
      purchaseLimitPerPerson: 10,
    })
    return { event, ticketType }
  }

  it('issues one ticket per unit, decrements stock, and marks the order paid', async () => {
    const { TicketService } = await import('./ticket.service.js')
    const { event, ticketType } = await makePaidEventWithTicketType(5)
    const buyer = await makeAttendee()

    const order = await Order.create({
      event: event._id,
      buyer: buyer._id,
      items: [{ ticketType: ticketType._id, quantity: 2, unitPrice: 5000 }],
      subtotal: 10000,
      platformFee: 500,
      organizerEarnings: 9500,
      total: 10000,
      status: 'pending',
      paystackReference: `TEST-${new mongoose.Types.ObjectId()}`,
    })

    const tickets = await TicketService.issueTicketsForPaidOrder(order, buyer)

    expect(tickets).toHaveLength(2)
    expect(new Set(tickets.map(t => t.code)).size).toBe(2) // codes are unique

    const updatedTicketType = await TicketType.findById(ticketType._id).lean()
    expect(updatedTicketType!.quantitySold).toBe(2)

    const updatedOrder = await Order.findById(order._id).lean()
    expect(updatedOrder!.status).toBe('paid')
    expect(updatedOrder!.payoutStatus).toBe('pending')

    const updatedEvent = await Event.findById(event._id).lean()
    expect(updatedEvent!.ticketsSoldCount).toBe(2)
    expect(updatedEvent!.revenueTotal).toBe(9500)
  })

  it('never oversells a ticket type under concurrent checkouts for the last unit', async () => {
    const { TicketService } = await import('./ticket.service.js')
    const { event, ticketType } = await makePaidEventWithTicketType(1) // only 1 unit available
    const buyers = await Promise.all(Array.from({ length: 5 }, () => makeAttendee()))

    const orders = await Promise.all(
      buyers.map(buyer =>
        Order.create({
          event: event._id,
          buyer: buyer._id,
          items: [{ ticketType: ticketType._id, quantity: 1, unitPrice: 5000 }],
          subtotal: 5000,
          platformFee: 250,
          organizerEarnings: 4750,
          total: 5000,
          status: 'pending',
          paystackReference: `TEST-${new mongoose.Types.ObjectId()}`,
        })
      )
    )

    const results = await Promise.allSettled(
      orders.map((order, i) => TicketService.issueTicketsForPaidOrder(order, buyers[i]))
    )

    const succeeded = results.filter(r => r.status === 'fulfilled')
    const failed = results.filter(r => r.status === 'rejected')

    expect(succeeded).toHaveLength(1)
    expect(failed).toHaveLength(4)

    const updatedTicketType = await TicketType.findById(ticketType._id).lean()
    expect(updatedTicketType!.quantitySold).toBe(1) // never exceeds quantity

    const ticketCount = await Ticket.countDocuments({ event: event._id })
    expect(ticketCount).toBe(1)
  })
})
