import { ParsedItemIntent, VoiceActionType } from './voiceTypes';

// Number mapping dictionaries for multi-lingual conversion
const NUMBER_WORD_MAP: Record<string, number> = {
  // English words
  'zero': 0,
  'a': 1,
  'an': 1,
  'one': 1,
  'single': 1,
  'two': 2,
  'double': 2,
  'three': 3,
  'triple': 3,
  'four': 4,
  'five': 5,
  'six': 6,
  'seven': 7,
  'eight': 8,
  'nine': 9,
  'ten': 10,
  'eleven': 11,
  'twelve': 12,
  'fifteen': 15,
  'twenty': 20,

  // Hindi transliteration (Hinglish)
  'shunya': 0,
  'ek': 1,
  'aik': 1,
  'ik': 1,
  'do': 2,
  'doh': 2,
  'doo': 2,
  'dho': 2,
  'teen': 3,
  'tin': 3,
  'chaar': 4,
  'char': 4,
  'paanch': 5,
  'panch': 5,
  'chhah': 6,
  'cheh': 6,
  'che': 6,
  'saat': 7,
  'sat': 7,
  'aath': 8,
  'ath': 8,
  'nau': 9,
  'nao': 9,
  'das': 10,
  'dass': 10,
  'gyarah': 11,
  'barah': 12,
  'pandrah': 15,
  'bees': 20,

  // Devanagari Hindi words
  'शून्य': 0,
  'एक': 1,
  'दो': 2,
  'तीन': 3,
  'चार': 4,
  'पाँच': 5,
  'पांच': 5,
  'छह': 6,
  'छः': 6,
  'सात': 7,
  'आठ': 8,
  'नौ': 9,
  'दस': 10,
  'ग्यारह': 11,
  'बारह': 12,
  'पंद्रह': 15,
  'बीस': 20,

  // Devanagari digits
  '०': 0,
  '१': 1,
  '२': 2,
  '३': 3,
  '४': 4,
  '५': 5,
  '६': 6,
  '७': 7,
  '८': 8,
  '९': 9,
  '१०': 10
};

// Common polite and conversational filler words to clean out
const NOISE_WORDS = new Set([
  'bhaiya', 'bhai', 'please', 'plz', 'karo', 'karna', 'kardo', 'kar do', 'do',
  'chahiye', 'mangta', 'lao', 'bhejo', 'de', 'dedo', 'de do', 'rakho',
  'order', 'item', 'items', 'plate', 'plates', 'glass', 'glasses', 'bottle',
  'bottles', 'portion', 'portions', 'cup', 'cups', 'pack', 'packet', 'parcel',
  'takeaway', 'serve', 'lagao', 'laga do', 'laga', 'bhi', 'aur ek', 'ek aur',
  'bhi do', 'bhi chahiye', 'bana do', 'banao', 'banao na', 'dalo', 'dal do',
  'jaldi', 'turant', 'fast', 'quick', 'sir', 'ji', 'zara', 'dena',
  'डालो', 'लाओ', 'भेजो', 'करो', 'चाहिए', 'प्लेट', 'ग्लास', 'बोतल', 'देना', 'जल्दी', 'जी'
]);

// Conjunctive splitters for multiple items in a single speech sentence
const SPLIT_CONJUNCTIONS = [
  ' aur ',
  ' and ',
  ' plus ',
  ' tatha ',
  ' evam ',
  ' or ',
  ' saath me ',
  ' sath me ',
  ' along with ',
  ' with ',
  ' और ',
  ' एवं ',
  ' तथा ',
  ' साथ में ',
  ',',
  ';',
  '\\+'
];

/**
 * Normalizes and parses raw user transcript into structured item intents.
 */
export function parseVoiceTranscript(rawTranscript: string): {
  overallAction: VoiceActionType;
  items: ParsedItemIntent[];
} {
  if (!rawTranscript || typeof rawTranscript !== 'string') {
    return { overallAction: 'UNKNOWN', items: [] };
  }

  const cleaned = rawTranscript.trim().toLowerCase();

  // 1. Detect Global Cart Actions
  if (
    cleaned.includes('clear cart') ||
    cleaned.includes('cart clear') ||
    cleaned.includes('empty cart') ||
    cleaned.includes('sab hata do') ||
    cleaned.includes('sab hatao') ||
    cleaned.includes('poora cart saaf') ||
    cleaned.includes('कार्ट खाली') ||
    cleaned.includes('सब हटाओ')
  ) {
    return { overallAction: 'CLEAR_CART', items: [] };
  }

  if (
    cleaned.includes('show cart') ||
    cleaned.includes('view cart') ||
    cleaned.includes('cart dikhao') ||
    cleaned.includes('cart check karo') ||
    cleaned.includes('कार्ट दिखाओ') ||
    cleaned.includes('ऑर्डर दिखाओ')
  ) {
    return { overallAction: 'VIEW_CART', items: [] };
  }

  // 2. Split into multi-item segments
  const segments = splitIntoItemSegments(cleaned);
  const items: ParsedItemIntent[] = [];

  for (const segment of segments) {
    const parsedItem = parseSingleItemSegment(segment);
    if (parsedItem) {
      items.push(parsedItem);
    }
  }

  return {
    overallAction: items.length > 0 ? items[0].action : 'ADD_ITEM',
    items
  };
}

/**
 * Splits a composite transcript into individual item segments.
 */
function splitIntoItemSegments(transcript: string): string[] {
  let normalized = transcript;
  for (const conj of SPLIT_CONJUNCTIONS) {
    normalized = normalized.split(conj).join(' __SPLIT__ ');
  }

  return normalized
    .split('__SPLIT__')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parses an individual segment into a single item intent with quantity and action.
 */
export function parseSingleItemSegment(rawSegment: string): ParsedItemIntent | null {
  if (!rawSegment || rawSegment.trim().length === 0) return null;

  let segment = rawSegment.trim();
  let action: VoiceActionType = 'ADD_ITEM';

  // Check specific action modifiers
  if (
    segment.includes('hata do') ||
    segment.includes('hatao') ||
    segment.includes('delete') ||
    segment.includes('remove') ||
    segment.includes('cancel') ||
    segment.includes('हटाओ') ||
    segment.includes('डिलीट')
  ) {
    action = 'REMOVE_ITEM';
    segment = segment
      .replace(/hata do|hatao|delete|remove|cancel|हटाओ|डिलीट/gi, ' ')
      .trim();
  } else if (
    segment.includes('kam karo') ||
    segment.includes('ghatao') ||
    segment.includes('decrease') ||
    segment.includes('minus') ||
    segment.includes('कम करो')
  ) {
    action = 'DECREASE_QUANTITY';
    segment = segment
      .replace(/kam karo|ghatao|decrease|minus|कम करो/gi, ' ')
      .trim();
  } else if (
    segment.includes('badhao') ||
    segment.includes('ek aur') ||
    segment.includes('aur ek') ||
    segment.includes('increase') ||
    segment.includes('plus') ||
    segment.includes('बढ़ाओ') ||
    segment.includes('एक और')
  ) {
    action = 'INCREASE_QUANTITY';
    segment = segment
      .replace(/badhao|increase|plus|बढ़ाओ/gi, ' ')
      .trim();
  }

  const tokens = segment.split(/\s+/).filter((t) => t.length > 0);
  let detectedQuantity = 1;
  let quantityFound = false;
  const remainingTokens: string[] = [];

  // Parse tokens for numeric values and clean noise
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // Check if mapped number word (including zero / shunya / devanagari)
    if (NUMBER_WORD_MAP[token] !== undefined) {
      detectedQuantity = NUMBER_WORD_MAP[token];
      quantityFound = true;
      continue;
    }

    // Check if numeric (integer, decimal, negative, or zero)
    const numericMatch = token.match(/^-?\d+(\.\d+)?$/);
    if (numericMatch) {
      const parsedNum = parseFloat(token);
      if (!isNaN(parsedNum)) {
        detectedQuantity = parsedNum;
        quantityFound = true;
        continue;
      }
    }

    // Check noise / filler words
    if (NOISE_WORDS.has(token)) {
      continue;
    }

    remainingTokens.push(token);
  }

  // If no explicit quantity was found, default to 1
  if (!quantityFound) {
    detectedQuantity = 1;
  }

  const cleanedName = remainingTokens.join(' ').trim();

  // If after cleaning nothing is left, ignore segment
  if (cleanedName.length === 0) {
    return null;
  }

  return {
    rawQuery: rawSegment,
    cleanedName,
    quantity: detectedQuantity,
    action
  };
}
