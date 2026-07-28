import crypto from 'crypto'

/**
 * Generate a numeric OTP of the given length (default 6 digits).
 */
export const generateOTP = (length: number = 6): string => {
  const digits = '0123456789'
  let otp = ''
  for (let i = 0; i < length; i++) {
    otp += digits[crypto.randomInt(0, digits.length)]
  }
  return otp
}

/**
 * Slugify a string for use in URLs (e.g. event titles).
 */
export const slugify = (value: string): string => {
  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * Strip sensitive/internal fields off a Mongoose lean user doc before sending to the client.
 */
export const sanitizeUser = (user: Record<string, any>): Record<string, any> => {
  const { password, emailVerificationOTP, emailVerificationOTPExpiry, __v, ...safe } = user
  return safe
}

/**
 * Escapes regex special characters in user-supplied search text before it's
 * used to build a `new RegExp(...)` — without this, a query string like
 * `.*` or a long pathological pattern can behave unexpectedly or cause a
 * slow regex match (ReDoS) instead of matching as a literal substring.
 */
export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * True only for a syntactically valid Mongo ObjectId string. Use this before
 * assigning a raw query-param value onto a Mongoose filter object — express's
 * query parser turns `?field[$ne]=x` into `{ field: { $ne: 'x' } }`, so a
 * filter built from an unvalidated query value can smuggle in Mongo operators.
 */
export const isValidObjectId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f\d]{24}$/i.test(value)

/**
 * Computes a [from, to] Date range for Explore's "When" filter. `from` is
 * always `now` (not start-of-day) — an event that already started earlier
 * today is treated as no longer "upcoming" for filtering purposes; this is
 * a deliberate simplification, not a bug, for the MVP.
 */
export const getDateRangeForWhen = (
  when: 'today' | 'this-weekend' | 'this-week' | 'this-month',
  now: Date = new Date()
): { from: Date; to: Date } => {
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
  const dayOfWeek = now.getDay() // 0 = Sunday, 6 = Saturday

  switch (when) {
    case 'today':
      return { from: now, to: endOfDay(now) }

    case 'this-weekend': {
      const daysUntilSaturday = dayOfWeek === 6 ? 0 : dayOfWeek === 0 ? -1 : 6 - dayOfWeek
      const saturday = new Date(now)
      saturday.setDate(now.getDate() + daysUntilSaturday)
      const sunday = new Date(saturday)
      sunday.setDate(saturday.getDate() + 1)
      return { from: now, to: endOfDay(sunday) }
    }

    case 'this-week': {
      const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek
      const sunday = new Date(now)
      sunday.setDate(now.getDate() + daysUntilSunday)
      return { from: now, to: endOfDay(sunday) }
    }

    case 'this-month': {
      const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { from: now, to: endOfDay(lastDayOfMonth) }
    }
  }
}

/**
 * Standard pagination extractor for controllers.
 */
export const getPagination = (query: Record<string, any>) => {
  const page = Math.max(Number(query.page) || 1, 1)
  const limit = Math.max(Number(query.limit) || 10, 1)
  const skip = (page - 1) * limit
  return { page, limit, skip }
}

/**
 * Build the `meta` object for paginated responses.
 */
export const buildPaginationMeta = (currentPage: number, limit: number, total: number) => {
  const totalPages = Math.max(Math.ceil(total / limit), 1)
  return {
    currentPage,
    limit,
    total,
    totalPages,
    hasMore: currentPage < totalPages,
  }
}
