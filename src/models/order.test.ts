import mongoose from 'mongoose'
import { describe, expect, it } from 'vitest'
import { calculateOrderTotals } from './order.js'

const ticketTypeId = new mongoose.Types.ObjectId()

describe('calculateOrderTotals', () => {
  it('matches the PRD worked example: ₦10,000 ticket → ₦500 fee, ₦9,500 to organizer', () => {
    const totals = calculateOrderTotals([{ ticketType: ticketTypeId, quantity: 1, unitPrice: 10000 }])

    expect(totals.subtotal).toBe(10000)
    expect(totals.platformFee).toBe(500)
    expect(totals.organizerEarnings).toBe(9500)
    // The attendee pays the ticket price as-is — the fee comes out of the organizer's share, not on top.
    expect(totals.total).toBe(totals.subtotal)
  })

  it('sums multiple line items before taking the commission', () => {
    const totals = calculateOrderTotals([
      { ticketType: ticketTypeId, quantity: 2, unitPrice: 5000 }, // 10,000
      { ticketType: ticketTypeId, quantity: 1, unitPrice: 15000 }, // 15,000
    ])

    expect(totals.subtotal).toBe(25000)
    expect(totals.platformFee).toBe(1250)
    expect(totals.organizerEarnings).toBe(23750)
  })

  it('rounds the platform fee to the nearest Naira', () => {
    const totals = calculateOrderTotals([{ ticketType: ticketTypeId, quantity: 1, unitPrice: 999 }])

    // 999 * 0.05 = 49.95 → rounds to 50
    expect(totals.platformFee).toBe(50)
    expect(totals.organizerEarnings).toBe(949)
  })
})
