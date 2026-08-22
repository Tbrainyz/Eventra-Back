import PlatformSettings, { type IPlatformSettings } from '../models/platformSettings.js'

// Short in-memory cache — read on essentially every checkout (via
// getCommissionRatePercent, called from createEvent) and by the
// maintenance-mode middleware on every request, so hitting Mongo each time
// would be wasteful for a value that changes maybe a few times a year.
// Cleared immediately on every admin update (see updatePlatformSettings)
// so a settings change is never stale for longer than one write.
let cached: IPlatformSettings | null = null

export async function getPlatformSettings(): Promise<IPlatformSettings> {
  if (cached) return cached

  let settings = await PlatformSettings.findOne()
  if (!settings) {
    settings = await PlatformSettings.create({})
  }
  cached = settings
  return settings
}

export async function updatePlatformSettings(patch: Partial<IPlatformSettings>): Promise<IPlatformSettings> {
  const current = await getPlatformSettings()
  Object.assign(current, patch)
  await current.save()
  cached = current
  return current
}

export function invalidatePlatformSettingsCache(): void {
  cached = null
}
