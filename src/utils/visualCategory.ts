/**
 * Visual-First Category & Food Visual Helpers
 * Provides recognizable emojis, icons, and visual color tokens for low-literacy operators.
 */

export interface CategoryVisual {
  emoji: string;
  badgeBg: string;
  badgeText: string;
}

export function getCategoryVisual(categoryName?: string | null): CategoryVisual {
  if (!categoryName) {
    return { emoji: '🍽️', badgeBg: 'bg-slate-100', badgeText: 'text-slate-700' };
  }

  const norm = categoryName.toLowerCase().trim();

  if (norm.includes('biryani') || norm.includes('rice') || norm.includes('pulao') || norm.includes('khichdi')) {
    return { emoji: '🍛', badgeBg: 'bg-amber-100', badgeText: 'text-amber-800' };
  }
  if (
    norm.includes('drink') ||
    norm.includes('beverage') ||
    norm.includes('juice') ||
    norm.includes('shake') ||
    norm.includes('tea') ||
    norm.includes('chai') ||
    norm.includes('coffee') ||
    norm.includes('soda') ||
    norm.includes('cold') ||
    norm.includes('water')
  ) {
    return { emoji: '🥤', badgeBg: 'bg-sky-100', badgeText: 'text-sky-800' };
  }
  if (norm.includes('pizza')) {
    return { emoji: '🍕', badgeBg: 'bg-orange-100', badgeText: 'text-orange-800' };
  }
  if (norm.includes('burger') || norm.includes('sandwich') || norm.includes('wrap') || norm.includes('roll')) {
    return { emoji: '🍔', badgeBg: 'bg-amber-100', badgeText: 'text-amber-800' };
  }
  if (
    norm.includes('chicken') ||
    norm.includes('meat') ||
    norm.includes('mutton') ||
    norm.includes('kebab') ||
    norm.includes('tandoor') ||
    norm.includes('tikka') ||
    norm.includes('grill') ||
    norm.includes('fish') ||
    norm.includes('prawn')
  ) {
    return { emoji: '🍗', badgeBg: 'bg-rose-100', badgeText: 'text-rose-800' };
  }
  if (norm.includes('starter') || norm.includes('appetizer') || norm.includes('snack') || norm.includes('fries') || norm.includes('chaat')) {
    return { emoji: '🍟', badgeBg: 'bg-yellow-100', badgeText: 'text-yellow-800' };
  }
  if (norm.includes('bread') || norm.includes('roti') || norm.includes('naan') || norm.includes('paratha') || norm.includes('kulcha')) {
    return { emoji: '🫓', badgeBg: 'bg-amber-50', badgeText: 'text-amber-900' };
  }
  if (norm.includes('noodle') || norm.includes('chinese') || norm.includes('pasta') || norm.includes('soup') || norm.includes('ramen') || norm.includes('manchurian')) {
    return { emoji: '🍜', badgeBg: 'bg-red-100', badgeText: 'text-red-800' };
  }
  if (norm.includes('dessert') || norm.includes('sweet') || norm.includes('ice cream') || norm.includes('cake') || norm.includes('pastry') || norm.includes('kulfi')) {
    return { emoji: '🍰', badgeBg: 'bg-pink-100', badgeText: 'text-pink-800' };
  }
  if (norm.includes('dosa') || norm.includes('idli') || norm.includes('vada') || norm.includes('south') || norm.includes('sambar')) {
    return { emoji: '🥞', badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-800' };
  }
  if (norm.includes('thali') || norm.includes('meal') || norm.includes('combo')) {
    return { emoji: '🍱', badgeBg: 'bg-indigo-100', badgeText: 'text-indigo-800' };
  }
  if (norm.includes('salad') || norm.includes('healthy') || norm.includes('green') || norm.includes('raita')) {
    return { emoji: '🥗', badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-800' };
  }
  if (norm.includes('curry') || norm.includes('gravy') || norm.includes('dal') || norm.includes('paneer')) {
    return { emoji: '🍲', badgeBg: 'bg-orange-100', badgeText: 'text-orange-800' };
  }

  return { emoji: '🍽️', badgeBg: 'bg-slate-100', badgeText: 'text-slate-700' };
}

export function getItemFallbackVisual(name: string, foodType?: string): { emoji: string; bgGradient: string } {
  const norm = (name || '').toLowerCase();

  if (norm.includes('biryani') || norm.includes('rice') || norm.includes('pulao')) {
    return { emoji: '🍛', bgGradient: 'from-amber-100 to-orange-100' };
  }
  if (norm.includes('chicken') || norm.includes('tikka') || norm.includes('kebab') || norm.includes('tandoori')) {
    return { emoji: '🍗', bgGradient: 'from-rose-100 to-orange-100' };
  }
  if (norm.includes('paneer') || norm.includes('dal') || norm.includes('curry') || norm.includes('gravy')) {
    return { emoji: '🍲', bgGradient: 'from-amber-100 to-yellow-100' };
  }
  if (norm.includes('naan') || norm.includes('roti') || norm.includes('paratha') || norm.includes('bread')) {
    return { emoji: '🫓', bgGradient: 'from-stone-100 to-amber-100' };
  }
  if (norm.includes('pizza')) {
    return { emoji: '🍕', bgGradient: 'from-orange-100 to-amber-100' };
  }
  if (norm.includes('burger') || norm.includes('sandwich')) {
    return { emoji: '🍔', bgGradient: 'from-amber-100 to-orange-100' };
  }
  if (norm.includes('coke') || norm.includes('soda') || norm.includes('shake') || norm.includes('juice') || norm.includes('drink') || norm.includes('chai') || norm.includes('tea') || norm.includes('coffee')) {
    return { emoji: '🥤', bgGradient: 'from-sky-100 to-indigo-100' };
  }
  if (norm.includes('ice cream') || norm.includes('cake') || norm.includes('dessert') || norm.includes('sweet') || norm.includes('gulab')) {
    return { emoji: '🍨', bgGradient: 'from-pink-100 to-purple-100' };
  }
  if (norm.includes('dosa') || norm.includes('idli') || norm.includes('vada')) {
    return { emoji: '🥞', bgGradient: 'from-emerald-100 to-teal-100' };
  }
  if (norm.includes('noodle') || norm.includes('soup') || norm.includes('pasta') || norm.includes('manchurian')) {
    return { emoji: '🍜', bgGradient: 'from-red-100 to-orange-100' };
  }
  if (norm.includes('fries') || norm.includes('snack') || norm.includes('samosa') || norm.includes('pakora')) {
    return { emoji: '🍟', bgGradient: 'from-yellow-100 to-amber-100' };
  }

  // Fallbacks by foodType
  if (foodType === 'veg') {
    return { emoji: '🥗', bgGradient: 'from-emerald-50 to-emerald-100' };
  }
  if (foodType === 'egg') {
    return { emoji: '🍳', bgGradient: 'from-amber-50 to-amber-100' };
  }
  if (foodType === 'non-veg' || foodType === 'nonVeg') {
    return { emoji: '🍖', bgGradient: 'from-rose-50 to-rose-100' };
  }

  return { emoji: '🍽️', bgGradient: 'from-slate-100 to-slate-200' };
}
