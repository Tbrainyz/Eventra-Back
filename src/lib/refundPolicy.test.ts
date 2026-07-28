import { describe, expect, it } from 'vitest'
import { checkRefundEligibility } from './refundPolicy.js'

const DAY_MS = 24 * 60 * 60 * 1000
const eventStart = new Date('2026-12-25T18:00:00.000Z')

describe('checkRefundEligibility', () => {
  it('never allows a refund for a cancelled event (it was auto-refunded already)', () => {
    const result = checkRefundEligibility('cancelled', { type: 'refund-until-days-before', daysBefore: 7 }, eventStart)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/cancelled/i)
  })

  it('always allows a refund for a postponed event, even with a no-refunds policy', () => {
    const result = checkRefundEligibility('postponed', { type: 'no-refunds' }, eventStart)
    expect(result.allowed).toBe(true)
  })

  it('rejects when the policy is no-refunds', () => {
    const result = checkRefundEligibility('approved', { type: 'no-refunds' }, eventStart)
    expect(result.allowed).toBe(false)
  })

  it('rejects when there is no refund policy at all', () => {
    const result = checkRefundEligibility('approved', undefined, eventStart)
    expect(result.allowed).toBe(false)
  })

  it('allows a refund inside the deadline window', () => {
    const now = new Date(eventStart.getTime() - 10 * DAY_MS) // 10 days before, deadline is 7 days before
    const result = checkRefundEligibility('approved', { type: 'refund-until-days-before', daysBefore: 7 }, eventStart, now)
    expect(result.allowed).toBe(true)
  })

  it('rejects a refund request submitted after the deadline has passed', () => {
    const now = new Date(eventStart.getTime() - 3 * DAY_MS) // 3 days before, deadline is 7 days before — too late
    const result = checkRefundEligibility('approved', { type: 'refund-until-days-before', daysBefore: 7 }, eventStart, now)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/passed/i)
  })

  it('treats the exact deadline moment as still allowed (boundary check)', () => {
    const deadline = new Date(eventStart.getTime() - 7 * DAY_MS)
    const result = checkRefundEligibility('approved', { type: 'refund-until-days-before', daysBefore: 7 }, eventStart, deadline)
    expect(result.allowed).toBe(true)
  })
})
