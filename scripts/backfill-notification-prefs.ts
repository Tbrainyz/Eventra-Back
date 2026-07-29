import mongoose from 'mongoose'
import User from '../src/models/user.js'
import { env } from '../src/config/keys.js'

async function run() {
  await mongoose.connect(env.MONGO_URI)

  const result = await User.updateMany(
    { notificationPreferences: { $exists: false } },
    {
      $set: {
        notificationPreferences: {
          eventReminders: true,
          weeklyPicks: true,
          organizerUpdates: false,
        },
      },
    }
  )

  console.log(`Backfilled ${result.modifiedCount} user(s)`)
  await mongoose.disconnect()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})