export interface IPromotionPackage {
  id: string
  label: string
  priceNaira: number
  durationDays: number
  description: string
  placementLabel: string
  popular?: boolean
}

/**
 * Not DB-driven — add/edit entries here if pricing/placement changes. Order
 * here is display order on the Promotions page's package picker.
 */
export const PROMOTION_PACKAGES: IPromotionPackage[] = [
  {
    id: 'spotlight',
    label: 'Spotlight',
    priceNaira: 15000,
    durationDays: 3,
    description: 'Top of your categories and the Explore page',
    placementLabel: 'Top of Explore',
  },
  {
    id: 'featured',
    label: 'Featured',
    priceNaira: 35000,
    durationDays: 7,
    description: 'In the featured events section on the homepage',
    placementLabel: 'Featured Events (homepage)',
    popular: true,
  },
  {
    id: 'homepage-hero',
    label: 'Homepage Hero',
    priceNaira: 75000,
    durationDays: 14,
    description: 'Hero Banner plus homepage and explore placement',
    placementLabel: 'Hero + Homepage + Explore',
  },
]

export const getPromotionPackage = (id: string): IPromotionPackage | undefined =>
  PROMOTION_PACKAGES.find(pkg => pkg.id === id)
