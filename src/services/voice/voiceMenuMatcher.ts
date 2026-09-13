import { MenuItem } from '../../types/menu';
import {
  ParsedItemIntent,
  MatchedItemResult,
  AmbiguousMatchResult,
  UnmatchedResult,
  VoiceParseResult,
  VoiceLanguage,
  VoiceActionType
} from './voiceTypes';
import { parseVoiceTranscript } from './voiceParser';

const DEVANAGARI_WORD_TRANSLITERATIONS: Record<string, string> = {
  'वेज': 'veg',
  'चिकन': 'chicken',
  'मटन': 'mutton',
  'बिरयानी': 'biryani',
  'कोक': 'coke',
  'चाय': 'tea',
  'रोटी': 'roti',
  'बटर': 'butter',
  'नान': 'naan',
  'पनीर': 'paneer',
  'दाल': 'dal',
  'पानी': 'water'
};

function normalizeQuery(rawQuery: string): string {
  let q = rawQuery.toLowerCase().trim();
  for (const [devWord, engWord] of Object.entries(DEVANAGARI_WORD_TRANSLITERATIONS)) {
    if (q.includes(devWord)) {
      q = q.replace(new RegExp(devWord, 'g'), engWord);
    }
  }
  return q.trim();
}
const HINGLISH_ALIAS_MAP: Record<string, string[]> = {
  'chawal': ['rice', 'biryani', 'pulao'],
  'roti': ['roti', 'chapati', 'naan', 'kulcha', 'paratha'],
  'paani': ['water', 'mineral water'],
  'chai': ['tea', 'masala chai'],
  'murg': ['chicken'],
  'gosht': ['mutton', 'lamb'],
  'machli': ['fish'],
  'anda': ['egg', 'omelette'],
  'dahi': ['curd', 'raita', 'yogurt'],
  'meetha': ['dessert', 'sweet', 'gulab jamun', 'ice cream'],
  'cold drink': ['coke', 'pepsi', 'sprite', 'thums up', 'beverage'],
  'biryani': ['biryani'],
  'बिरयानी': ['biryani'],
  'चाय': ['tea', 'masala chai'],
  'रोटी': ['roti', 'chapati', 'naan', 'kulcha', 'paratha'],
  'पानी': ['water', 'mineral water'],
  'कोक': ['coke', 'pepsi', 'coca cola'],
  'मुर्ग': ['chicken'],
  'गोश्त': ['mutton', 'lamb'],
  'पनीर': ['paneer'],
  'दाल': ['dal', 'daal'],
  'वेज': ['veg', 'vegetable'],
  'चिकन': ['chicken'],
  'मटन': ['mutton'],
  'बटर': ['butter'],
  'नान': ['naan']
};

/**
 * Calculates Levenshtein Distance for fuzzy matching.
 */
function levenshteinDistance(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;

  const matrix = Array.from({ length: an + 1 }, () => new Array(bn + 1).fill(0));

  for (let i = 0; i <= an; i++) matrix[i][0] = i;
  for (let j = 0; j <= bn; j++) matrix[0][j] = j;

  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[an][bn];
}

/**
 * Computes string similarity score between 0 and 1.
 */
function computeSimilarity(s1: string, s2: string): number {
  const str1 = s1.toLowerCase().trim();
  const str2 = s2.toLowerCase().trim();

  if (str1 === str2) return 1.0;
  if (str1.length === 0 || str2.length === 0) return 0.0;

  const maxLen = Math.max(str1.length, str2.length);
  const dist = levenshteinDistance(str1, str2);
  return Math.max(0, (maxLen - dist) / maxLen);
}

/**
 * Matches a single parsed intent against the active menu items.
 */
export function matchItemAgainstMenu(
  intent: ParsedItemIntent,
  menuItems: MenuItem[]
): {
  matched?: MatchedItemResult;
  ambiguous?: AmbiguousMatchResult;
  unmatched?: UnmatchedResult;
} {
  // Enforce valid positive integer quantity
  if (
    typeof intent.quantity !== 'number' ||
    isNaN(intent.quantity) ||
    !isFinite(intent.quantity) ||
    intent.quantity <= 0 ||
    !Number.isInteger(intent.quantity) ||
    intent.quantity > 100
  ) {
    return {
      unmatched: {
        rawQuery: intent.rawQuery,
        quantity: intent.quantity,
        action: intent.action,
        suggestion: 'Invalid quantity specified. Quantity must be a positive whole number between 1 and 100.'
      }
    };
  }

  const query = normalizeQuery(intent.cleanedName);
  if (!query || menuItems.length === 0) {
    return {
      unmatched: {
        rawQuery: intent.rawQuery,
        quantity: intent.quantity,
        action: intent.action
      }
    };
  }

  // 1. Exact Name Matches (case-insensitive)
  const exactMatches = menuItems.filter(
    (item) =>
      item.name.toLowerCase().trim() === query ||
      (item.shortName && item.shortName.toLowerCase().trim() === query)
  );

  if (exactMatches.length === 1) {
    return {
      matched: {
        menuItem: exactMatches[0],
        quantity: intent.quantity,
        confidence: 1.0,
        action: intent.action,
        matchType: 'EXACT'
      }
    };
  } else if (exactMatches.length > 1) {
    return {
      ambiguous: {
        rawQuery: intent.rawQuery,
        quantity: intent.quantity,
        candidates: exactMatches,
        action: intent.action
      }
    };
  }

  // 2. Confident Word Inclusion & Substring Matches
  const queryTokens = query.split(/\s+/).filter((t) => t.length > 0);
  const substringCandidates: { item: MenuItem; score: number }[] = [];

  for (const item of menuItems) {
    const itemName = item.name.toLowerCase();
    const itemShort = (item.shortName || '').toLowerCase();

    // Check if query is exact substring of item name or vice versa
    if (itemName.includes(query) || (itemShort && itemShort.includes(query))) {
      substringCandidates.push({ item, score: 0.85 });
      continue;
    }

    // Check token overlap
    const itemTokens = `${itemName} ${itemShort}`.split(/\s+/);
    let matchedTokenCount = 0;
    for (const qToken of queryTokens) {
      if (itemTokens.some((iToken) => iToken.includes(qToken) || qToken.includes(iToken))) {
        matchedTokenCount++;
      }
    }

    if (queryTokens.length > 0 && matchedTokenCount === queryTokens.length) {
      substringCandidates.push({ item, score: 0.8 });
    }
  }

  if (substringCandidates.length === 1) {
    return {
      matched: {
        menuItem: substringCandidates[0].item,
        quantity: intent.quantity,
        confidence: substringCandidates[0].score,
        action: intent.action,
        matchType: 'CONFIDENT_SUBSTRING'
      }
    };
  } else if (substringCandidates.length > 1) {
    // If multiple candidates found (e.g. "biryani" -> Veg Biryani, Chicken Biryani)
    // NEVER guess silently. Surface as ambiguous match.
    return {
      ambiguous: {
        rawQuery: intent.rawQuery,
        quantity: intent.quantity,
        candidates: substringCandidates.map((c) => c.item),
        action: intent.action
      }
    };
  }

  // 3. Alias / Synonym Search
  for (const [aliasKey, synonyms] of Object.entries(HINGLISH_ALIAS_MAP)) {
    if (query.includes(aliasKey)) {
      const aliasCandidates = menuItems.filter((item) => {
        const lower = item.name.toLowerCase();
        return synonyms.some((syn) => lower.includes(syn));
      });

      if (aliasCandidates.length === 1) {
        return {
          matched: {
            menuItem: aliasCandidates[0],
            quantity: intent.quantity,
            confidence: 0.75,
            action: intent.action,
            matchType: 'FUZZY'
          }
        };
      } else if (aliasCandidates.length > 1) {
        return {
          ambiguous: {
            rawQuery: intent.rawQuery,
            quantity: intent.quantity,
            candidates: aliasCandidates,
            action: intent.action
          }
        };
      }
    }
  }

  // 4. Fuzzy Levenshtein Match with Strict Threshold (>= 0.72)
  const fuzzyCandidates: { item: MenuItem; score: number }[] = [];
  for (const item of menuItems) {
    const simName = computeSimilarity(query, item.name);
    const simShort = item.shortName ? computeSimilarity(query, item.shortName) : 0;
    const bestSim = Math.max(simName, simShort);

    if (bestSim >= 0.72) {
      fuzzyCandidates.push({ item, score: bestSim });
    }
  }

  fuzzyCandidates.sort((a, b) => b.score - a.score);

  if (fuzzyCandidates.length === 1) {
    return {
      matched: {
        menuItem: fuzzyCandidates[0].item,
        quantity: intent.quantity,
        confidence: fuzzyCandidates[0].score,
        action: intent.action,
        matchType: 'FUZZY'
      }
    };
  } else if (fuzzyCandidates.length > 1) {
    // If top match is significantly higher confidence (> 0.2 gap)
    if (fuzzyCandidates[0].score - fuzzyCandidates[1].score >= 0.2) {
      return {
        matched: {
          menuItem: fuzzyCandidates[0].item,
          quantity: intent.quantity,
          confidence: fuzzyCandidates[0].score,
          action: intent.action,
          matchType: 'FUZZY'
        }
      };
    } else {
      return {
        ambiguous: {
          rawQuery: intent.rawQuery,
          quantity: intent.quantity,
          candidates: fuzzyCandidates.map((f) => f.item),
          action: intent.action
        }
      };
    }
  }

  // 5. Unmatched
  return {
    unmatched: {
      rawQuery: intent.rawQuery,
      quantity: intent.quantity,
      action: intent.action,
      suggestion: 'Please verify the item name or search the menu.'
    }
  };
}

/**
 * End-to-end matching of raw speech transcript against active restaurant catalog.
 */
export function matchVoiceTranscriptToMenu(
  transcript: string,
  menuItems: MenuItem[],
  language: VoiceLanguage = 'auto',
  isFinal: boolean = true
): VoiceParseResult {
  const { overallAction, items } = parseVoiceTranscript(transcript);

  const matchedItems: MatchedItemResult[] = [];
  const ambiguousItems: AmbiguousMatchResult[] = [];
  const unmatchedItems: UnmatchedResult[] = [];

  for (const intent of items) {
    const res = matchItemAgainstMenu(intent, menuItems);
    if (res.matched) {
      matchedItems.push(res.matched);
    } else if (res.ambiguous) {
      ambiguousItems.push(res.ambiguous);
    } else if (res.unmatched) {
      unmatchedItems.push(res.unmatched);
    }
  }

  const isDestructive = overallAction === 'CLEAR_CART' || overallAction === 'REMOVE_ITEM';
  const needsClarification = ambiguousItems.length > 0;
  const requiresConfirmation = isFinal && (matchedItems.length > 0 || isDestructive);

  return {
    transcript,
    isFinal,
    language,
    action: overallAction,
    matchedItems,
    ambiguousItems,
    unmatchedItems,
    requiresConfirmation,
    needsClarification,
    isDestructive
  };
}

/**
 * Merges newly matched items into an existing voice-order draft session.
 * - Same item (by itemId) -> accumulates/updates quantity (or removes if quantity <= 0 or REMOVE_ITEM action)
 * - Different item -> appends to the voice-order draft list
 */
export function mergeMatchedItemResults(
  existingList: MatchedItemResult[],
  newList: MatchedItemResult[]
): MatchedItemResult[] {
  let updated = [...existingList];

  for (const newItem of newList) {
    const existingIndex = updated.findIndex(
      (m) => m.menuItem.itemId === newItem.menuItem.itemId
    );

    if (existingIndex >= 0) {
      const existing = updated[existingIndex];
      let finalQty = existing.quantity;

      if (newItem.action === 'ADD_ITEM' || newItem.action === 'INCREASE_QUANTITY') {
        finalQty = existing.quantity + newItem.quantity;
      } else if (newItem.action === 'DECREASE_QUANTITY') {
        finalQty = Math.max(0, existing.quantity - newItem.quantity);
      } else if (newItem.action === 'REMOVE_ITEM') {
        finalQty = 0;
      }

      if (finalQty <= 0) {
        updated = updated.filter((_, idx) => idx !== existingIndex);
      } else {
        updated[existingIndex] = {
          ...existing,
          quantity: finalQty,
          confidence: Math.max(existing.confidence, newItem.confidence),
          matchType: newItem.matchType
        };
      }
    } else {
      if (newItem.action !== 'REMOVE_ITEM' && newItem.action !== 'DECREASE_QUANTITY') {
        updated.push({ ...newItem });
      }
    }
  }

  return updated;
}
