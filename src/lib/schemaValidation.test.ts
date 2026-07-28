import { describe, expect, it } from 'vitest'
import {
  checkInSchema,
  checkoutSchema,
  createEventSchema,
  createTicketTypeSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from './schemaValidation.js'

describe('registerSchema', () => {
  it('accepts a valid registration payload', () => {
    const result = registerSchema.safeParse({
      fullname: 'Ada Lovelace',
      email: 'ADA@Example.com',
      password: 'password123',
      phone: '08012345678',
    })
    expect(result.success).toBe(true)
    // email is normalized to lowercase/trimmed
    if (result.success) expect(result.data.email).toBe('ada@example.com')
  })

  it('rejects a password shorter than 8 characters', () => {
    const result = registerSchema.safeParse({
      fullname: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'short',
      phone: '08012345678',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid email', () => {
    const result = registerSchema.safeParse({
      fullname: 'Ada Lovelace',
      email: 'not-an-email',
      password: 'password123',
      phone: '08012345678',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a role other than attendee/organizer (admin can never self-register)', () => {
    const result = registerSchema.safeParse({
      fullname: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'password123',
      phone: '08012345678',
      role: 'admin',
    })
    expect(result.success).toBe(false)
  })
})

describe('loginSchema', () => {
  it('rejects a missing password', () => {
    const result = loginSchema.safeParse({ email: 'ada@example.com', password: '' })
    expect(result.success).toBe(false)
  })
})

describe('checkoutSchema', () => {
  it('requires at least one item', () => {
    const result = checkoutSchema.safeParse({ items: [] })
    expect(result.success).toBe(false)
  })

  it('rejects a non-positive quantity', () => {
    const result = checkoutSchema.safeParse({ items: [{ ticketTypeId: '123', quantity: 0 }] })
    expect(result.success).toBe(false)
  })

  it('accepts a valid multi-item checkout', () => {
    const result = checkoutSchema.safeParse({
      items: [
        { ticketTypeId: 'abc123', quantity: 2 },
        { ticketTypeId: 'def456', quantity: 1 },
      ],
    })
    expect(result.success).toBe(true)
  })
})

describe('createEventSchema', () => {
  const validEvent = {
    title: 'Lagos Tech Meetup',
    description: 'A great meetup for developers',
    category: '507f1f77bcf86cd799439011',
    type: 'free' as const,
    venue: { name: 'Tech Hub', address: '1 Innovation Way', city: 'Lagos' },
    startDate: '2026-12-01T18:00:00.000Z',
  }

  it('accepts a minimal valid free event', () => {
    const result = createEventSchema.safeParse(validEvent)
    expect(result.success).toBe(true)
  })

  it('rejects a title shorter than 3 characters', () => {
    const result = createEventSchema.safeParse({ ...validEvent, title: 'Hi' })
    expect(result.success).toBe(false)
  })

  it('rejects an event type outside free/paid', () => {
    const result = createEventSchema.safeParse({ ...validEvent, type: 'vip' })
    expect(result.success).toBe(false)
  })

  it('rejects a venue missing a required field', () => {
    const result = createEventSchema.safeParse({
      ...validEvent,
      venue: { name: 'Tech Hub', city: 'Lagos' }, // missing address
    })
    expect(result.success).toBe(false)
  })
})

describe('createTicketTypeSchema', () => {
  it('rejects a negative price', () => {
    const result = createTicketTypeSchema.safeParse({ name: 'Regular', price: -100, quantity: 10 })
    expect(result.success).toBe(false)
  })

  it('rejects a non-positive quantity', () => {
    const result = createTicketTypeSchema.safeParse({ name: 'Regular', price: 5000, quantity: 0 })
    expect(result.success).toBe(false)
  })

  it('accepts a valid ticket type', () => {
    const result = createTicketTypeSchema.safeParse({ name: 'VIP', price: 15000, quantity: 50 })
    expect(result.success).toBe(true)
  })
})

describe('updateProfileSchema', () => {
  it('rejects a new password without the current password', () => {
    const result = updateProfileSchema.safeParse({ newPassword: 'newpassword123' })
    expect(result.success).toBe(false)
  })

  it('accepts a new password when the current password is supplied', () => {
    const result = updateProfileSchema.safeParse({
      currentPassword: 'oldpassword123',
      newPassword: 'newpassword123',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a profile update with no password change at all', () => {
    const result = updateProfileSchema.safeParse({ fullname: 'New Name' })
    expect(result.success).toBe(true)
  })
})

describe('checkInSchema', () => {
  it('rejects an empty code', () => {
    const result = checkInSchema.safeParse({ code: '' })
    expect(result.success).toBe(false)
  })

  it('accepts a valid code', () => {
    const result = checkInSchema.safeParse({ code: 'EVT-TKT-abc123' })
    expect(result.success).toBe(true)
  })
})
