import { describe, expect, it } from 'vitest'
import { buildPaginationMeta, generateOTP, getDateRangeForWhen, getPagination, sanitizeUser, slugify } from './utils.js'

describe('generateOTP', () => {
  it('defaults to a 6-digit numeric code', () => {
    const otp = generateOTP()
    expect(otp).toMatch(/^\d{6}$/)
  })

  it('respects a custom length', () => {
    const otp = generateOTP(4)
    expect(otp).toMatch(/^\d{4}$/)
  })

  it('is not obviously predictable across repeated calls', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateOTP()))
    // Vanishingly unlikely to collide 20 times in a row if the RNG is sound.
    expect(codes.size).toBeGreaterThan(1)
  })
})

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Lagos Tech Meetup 2026')).toBe('lagos-tech-meetup-2026')
  })

  it('strips non-alphanumeric characters', () => {
    expect(slugify("Naija's Biggest Party!!")).toBe('naija-s-biggest-party')
  })

  it('trims leading/trailing hyphens', () => {
    expect(slugify('  --Weird Title--  ')).toBe('weird-title')
  })
})

describe('sanitizeUser', () => {
  it('strips password and OTP fields', () => {
    const raw = {
      _id: '123',
      fullname: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'hashed-secret',
      emailVerificationOTP: '123456',
      emailVerificationOTPExpiry: new Date(),
      __v: 0,
    }

    const safe = sanitizeUser(raw)

    expect(safe).not.toHaveProperty('password')
    expect(safe).not.toHaveProperty('emailVerificationOTP')
    expect(safe).not.toHaveProperty('emailVerificationOTPExpiry')
    expect(safe).not.toHaveProperty('__v')
    expect(safe.fullname).toBe('Ada Lovelace')
    expect(safe.email).toBe('ada@example.com')
  })
})

describe('getPagination', () => {
  it('defaults to page 1, limit 10', () => {
    expect(getPagination({})).toEqual({ page: 1, limit: 10, skip: 0 })
  })

  it('computes skip from page and limit', () => {
    expect(getPagination({ page: '3', limit: '20' })).toEqual({ page: 3, limit: 20, skip: 40 })
  })

  it('falls back to defaults for invalid/zero values, and clamps negative page to 1', () => {
    expect(getPagination({ page: '-5', limit: '0' })).toEqual({ page: 1, limit: 10, skip: 0 })
  })

  it('clamps a negative limit to the minimum of 1', () => {
    expect(getPagination({ limit: '-3' })).toEqual({ page: 1, limit: 1, skip: 0 })
  })
})

describe('buildPaginationMeta', () => {
  it('reports hasMore correctly mid-list', () => {
    const meta = buildPaginationMeta(1, 10, 25)
    expect(meta).toEqual({ currentPage: 1, limit: 10, total: 25, totalPages: 3, hasMore: true })
  })

  it('reports hasMore=false on the last page', () => {
    const meta = buildPaginationMeta(3, 10, 25)
    expect(meta.hasMore).toBe(false)
  })

  it('never reports zero total pages, even with zero results', () => {
    const meta = buildPaginationMeta(1, 10, 0)
    expect(meta.totalPages).toBe(1)
  })
})

describe('getDateRangeForWhen', () => {
  // Fixed reference points so these tests never depend on the real "today".
  const wednesday = new Date(2026, 1, 11, 10, 0, 0) // Wed 11 Feb 2026
  const saturday = new Date(2026, 1, 14, 10, 0, 0) // Sat 14 Feb 2026
  const sunday = new Date(2026, 1, 15, 10, 0, 0) // Sun 15 Feb 2026

  it("'today' spans from now to the end of today", () => {
    const { from, to } = getDateRangeForWhen('today', wednesday)
    expect(from).toEqual(wednesday)
    expect(to.toDateString()).toBe(new Date(2026, 1, 11).toDateString())
    expect(to.getHours()).toBe(23)
  })

  it("'this-weekend' from a midweek day spans through the upcoming Sunday", () => {
    const { to } = getDateRangeForWhen('this-weekend', wednesday)
    expect(to.toDateString()).toBe(new Date(2026, 1, 15).toDateString()) // Sunday 15th
  })

  it("'this-weekend' from Saturday still includes that same weekend", () => {
    const { to } = getDateRangeForWhen('this-weekend', saturday)
    expect(to.toDateString()).toBe(new Date(2026, 1, 15).toDateString())
  })

  it("'this-weekend' from Sunday covers through today, not next weekend", () => {
    const { to } = getDateRangeForWhen('this-weekend', sunday)
    expect(to.toDateString()).toBe(new Date(2026, 1, 15).toDateString())
  })

  it("'this-week' spans through the upcoming Sunday", () => {
    const { to } = getDateRangeForWhen('this-week', wednesday)
    expect(to.toDateString()).toBe(new Date(2026, 1, 15).toDateString())
  })

  it("'this-month' spans through the last calendar day of the month", () => {
    const { to } = getDateRangeForWhen('this-month', wednesday)
    expect(to.toDateString()).toBe(new Date(2026, 1, 28).toDateString()) // Feb 2026 has 28 days
  })

  it('never returns a "from" earlier than the reference time (no past events)', () => {
    const { from } = getDateRangeForWhen('this-month', wednesday)
    expect(from).toEqual(wednesday)
  })
})
