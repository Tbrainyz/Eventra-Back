export interface IPromotionPackage {
  id: string
  label: string
  priceNaira: number
  durationDays: number
}

/**
 * Kept simple per the PRD ("one or two promotion packages" for this release).
 * Not DB-driven — add/edit entries here if pricing changes.
 */
export const PROMOTION_PACKAGES: IPromotionPackage[] = [
  { id: 'featured-7d', label: 'Featured — 7 days', priceNaira: 15000, durationDays: 7 },
  { id: 'featured-14d', label: 'Featured — 14 days', priceNaira: 25000, durationDays: 14 },
]

export const getPromotionPackage = (id: string): IPromotionPackage | undefined =>
  PROMOTION_PACKAGES.find(pkg => pkg.id === id)
