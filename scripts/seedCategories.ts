/**
 * One-time/idempotent seed script for the default event category list.
 * Run with: npm run seed:categories
 * Safe to re-run — existing categories (matched by slug) are left untouched.
 */
import mongoose from 'mongoose'
import { env } from '../src/config/keys.js'
import Category from '../src/models/category.js'
import { slugify } from '../src/lib/utils.js'

const DEFAULT_CATEGORIES = [
  'Music',
  'Conference',
  'Tech & Startups',
  'Comedy',
  'Sports',
  'Arts & Theatre',
  'Food & Drink',
  'Networking',
  'Workshop',
  'Religious',
]

const seed = async () => {
  await mongoose.connect(env.MONGO_URI, { dbName: env.DATABASE_NAME })
  console.log('Connected — seeding categories...')

  let created = 0
  let skipped = 0

  for (const name of DEFAULT_CATEGORIES) {
    const slug = slugify(name)
    const existing = await Category.findOne({ slug })
    if (existing) {
      skipped++
      continue
    }
    await Category.create({ name, slug })
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
