/**
 * One-time/idempotent seed script for dummy *approved* events (matched by
 * slug), so GET /api/v1/events returns something real while the frontend
 * is being wired up — instead of the Explore page looking empty/broken.
 *
 * Requires categories to exist first: run `npm run seed:categories` before
 * this script, and requires at least one 'organizer' role user with an
 * approved organizerProfile — one is created here if none exists.
 *
 * Run with: npm run seed:events
 * Safe to re-run — existing events (matched by slug) are left untouched.
 */
import mongoose from 'mongoose'
import { env } from '../src/config/keys.js'
import Category from '../src/models/category.js'
import Event from '../src/models/event.js'
import TicketType from '../src/models/ticketType.js'
import User from '../src/models/user.js'
import { slugify } from '../src/lib/utils.js'

const SEED_ORGANIZER_EMAIL = 'seed.organizer@eventra.dev'

const DUMMY_EVENTS = [
  {
    title: 'Afrobeats Night Market',
    categoryName: 'Music',
    type: 'paid' as const,
    coverImage: '/events/ama.png',
    venue: { name: 'Muri Okunola Park', address: 'Muri Okunola Park', city: 'Lagos', state: 'Lagos' },
    daysFromNow: 14,
    isPromoted: true,
    ticketTypes: [{ name: 'Regular', price: 15000, quantity: 200 }],
  },
  {
    title: 'Amapiano All Night',
    categoryName: 'Music',
    type: 'paid' as const,
    coverImage: '/events/chat.png',
    venue: { name: 'Hard Rock Cafe', address: '3 Water Corporation Rd', city: 'Lagos', state: 'Lagos' },
    daysFromNow: 18,
    ticketTypes: [{ name: 'Regular', price: 15000, quantity: 150 }, { name: 'VIP', price: 35000, quantity: 40 }],
  },
  {
    title: 'Sunset Rooftop Party',
    categoryName: 'Music',
    type: 'paid' as const,
    coverImage: '/events/roof.jpg',
    venue: { name: 'Eko Hotel', address: '1415 Adetokunbo Ademola St', city: 'Lagos', state: 'Lagos' },
    daysFromNow: 22,
    ticketTypes: [{ name: 'Regular', price: 20000, quantity: 100 }],
  },
  {
    title: 'Lagos Tech Week 2026',
    categoryName: 'Tech & Startups',
    type: 'paid' as const,
    coverImage: '/events/techfest.svg',
    venue: { name: 'Landmark Event Centre', address: 'Water Corporation Rd', city: 'Lagos', state: 'Lagos' },
    daysFromNow: 40,
    ticketTypes: [{ name: 'Regular', price: 25000, quantity: 300 }, { name: 'VIP', price: 60000, quantity: 60 }],
  },
  {
    title: 'Comedy Central Live',
    categoryName: 'Comedy',
    type: 'paid' as const,
    coverImage: '/events/images.jpg',
    venue: { name: 'Terra Kulture', address: '1376 Tiamiyu Savage St', city: 'Lagos', state: 'Lagos' },
    daysFromNow: 10,
    ticketTypes: [{ name: 'Regular', price: 10000, quantity: 120 }],
  },
  {
    title: 'Lagos Jollof Festival',
    categoryName: 'Food & Drink',
    type: 'free' as const,
    coverImage: '/events/watch.png',
    venue: { name: 'Freedom Park', address: '1 Broad St', city: 'Lagos', state: 'Lagos' },
    daysFromNow: 12,
    ticketTypes: [],
  },
  {
    title: 'Detty December Boat Party',
    categoryName: 'Music',
    type: 'paid' as const,
    coverImage: '/events/detty.jpg',
    venue: { name: 'Tarkwa Bay', address: 'Tarkwa Bay Jetty', city: 'Lagos', state: 'Lagos' },
    daysFromNow: 30,
    ticketTypes: [{ name: 'Regular', price: 15000, quantity: 80 }],
  },
  {
    title: 'Sunday League Final',
    categoryName: 'Sports',
    type: 'free' as const,
    coverImage: '/events/watch.png',
    venue: { name: 'Teslim Balogun Stadium', address: 'Surulere', city: 'Lagos', state: 'Lagos' },
    daysFromNow: 8,
    ticketTypes: [],
  },
]

const ensureSeedOrganizer = async () => {
  let organizer = await User.findOne({ email: SEED_ORGANIZER_EMAIL })
  if (organizer) return organizer

  organizer = await User.create({
    fullname: 'Eventra Seed Organizer',
    email: SEED_ORGANIZER_EMAIL,
    password: 'Seed@12345', // dev-only account — never used to log in in seeded environments
    phone: '+2340000000000',
    role: 'organizer',
    isVerified: true,
    organizerProfile: {
      businessName: 'Eventra Seed Co.',
      approvalStatus: 'approved',
      isPayoutReady: false,
    },
  })
  console.log(`Created seed organizer: ${organizer.email}`)
  return organizer
}

const seed = async () => {
  await mongoose.connect(env.MONGO_URI, { dbName: env.DATABASE_NAME })
  console.log('Connected — seeding events...')

  const organizer = await ensureSeedOrganizer()

  let created = 0
  let skipped = 0

  for (const dummy of DUMMY_EVENTS) {
    const slug = `${slugify(dummy.title)}-seed`
    const existing = await Event.findOne({ slug })
    if (existing) {
      skipped++
      continue
    }

    const category = await Category.findOne({ name: dummy.categoryName })
    if (!category) {
      console.warn(`Skipping "${dummy.title}" — category "${dummy.categoryName}" not found. Run seed:categories first.`)
      continue
    }

    const startDate = new Date(Date.now() + dummy.daysFromNow * 24 * 60 * 60 * 1000)
    const minPrice = dummy.ticketTypes.length ? Math.min(...dummy.ticketTypes.map(t => t.price)) : 0

    const event = await Event.create({
      organizer: organizer._id,
      title: dummy.title,
      slug,
      description: `${dummy.title} — seeded dummy event for local development.`,
      category: category._id,
      type: dummy.type,
      coverImage: dummy.coverImage,
      venue: dummy.venue,
      startDate,
      status: 'approved',
      isPromoted: dummy.isPromoted ?? false,
      publishedAt: new Date(),
      minPrice,
    })

    for (const tt of dummy.ticketTypes) {
      await TicketType.create({ event: event._id, name: tt.name, price: tt.price, quantity: tt.quantity })
    }

    created++
  }

  console.log(`Done — ${created} created, ${skipped} already existed.`)
  await mongoose.disconnect()
  process.exit(0)
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
