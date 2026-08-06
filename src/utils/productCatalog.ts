// Known category-name variants (typos / inconsistent bulk-import casing) that should be
// reported as a single standardized category instead of showing up as separate duplicates
// (e.g. "GIFT BOXS" vs "Gift Boxes and Giveaways", "AL OUD" vs "Oud").
const CATEGORY_NAME_VARIANTS: Record<string, string> = {
  'al oud': 'Oud',
  'oud': 'Oud',
  'gift boxs': 'Gift Boxes and Giveaways',
  'gift boxes and giveaways': 'Gift Boxes and Giveaways',
};

export function normalizeCategoryName(name?: string): string {
  const trimmed = String(name || '').trim();
  if (!trimmed) return trimmed;
  const key = trimmed.toLowerCase().replace(/\s+/g, ' ');
  return CATEGORY_NAME_VARIANTS[key] || trimmed;
}

export function generatePathSegment(value?: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Builds the storefront URL for a product, e.g. https://store.com/shop/oud/product-slug
export function buildProductUrl(
  frontendUrl: string,
  product: { slug?: string; categorySlug?: string; categoryName?: string },
): string {
  const baseUrl = String(frontendUrl || '').replace(/\/+$/, '');
  const categorySegment = product.categorySlug || generatePathSegment(product.categoryName);
  return `${baseUrl}/shop/${categorySegment ? `${categorySegment}/` : ''}${product.slug || ''}`;
}
