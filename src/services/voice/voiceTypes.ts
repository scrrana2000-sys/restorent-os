import { MenuItem } from '../../types/menu';
import { CartItem } from '../../types/cart';

/**
 * Voice Recognition State Machine
 */
export type VoiceState =
  | 'IDLE'
  | 'LISTENING'
  | 'PROCESSING'
  | 'MATCHED'
  | 'NEEDS_CLARIFICATION'
  | 'CONFIRMATION'
  | 'ADDING_TO_CART'
  | 'ERROR';

/**
 * Supported Language Codes for Speech Recognition
 */
export type VoiceLanguage = 'auto' | 'en-IN' | 'hi-IN' | 'en-US';

/**
 * Voice Recognized Action Types
 */
export type VoiceActionType =
  | 'ADD_ITEM'
  | 'REMOVE_ITEM'
  | 'INCREASE_QUANTITY'
  | 'DECREASE_QUANTITY'
  | 'CLEAR_CART'
  | 'VIEW_CART'
  | 'UNKNOWN';

/**
 * Raw Parsed Item Intent from Tokenizer
 */
export interface ParsedItemIntent {
  rawQuery: string;
  cleanedName: string;
  quantity: number;
  action: VoiceActionType;
  notes?: string;
  variantRequested?: string;
}

/**
 * Matched Item Result
 */
export interface MatchedItemResult {
  menuItem: MenuItem;
  quantity: number;
  confidence: number; // 0 to 1
  action: VoiceActionType;
  matchType: 'EXACT' | 'CONFIDENT_SUBSTRING' | 'FUZZY';
  selectedVariant?: string;
  notes?: string;
}

/**
 * Ambiguous Match Result requiring User Clarification
 */
export interface AmbiguousMatchResult {
  rawQuery: string;
  quantity: number;
  candidates: MenuItem[];
  action: VoiceActionType;
}

/**
 * Unmatched Query Result
 */
export interface UnmatchedResult {
  rawQuery: string;
  quantity: number;
  action: VoiceActionType;
  suggestion?: string;
}

/**
 * Overall Voice Parse & Match Result
 */
export interface VoiceParseResult {
  transcript: string;
  isFinal: boolean;
  language: VoiceLanguage;
  action: VoiceActionType;
  matchedItems: MatchedItemResult[];
  ambiguousItems: AmbiguousMatchResult[];
  unmatchedItems: UnmatchedResult[];
  requiresConfirmation: boolean;
  needsClarification: boolean;
  isDestructive: boolean; // e.g. clear cart
}

/**
 * Speech Recognition Error Types
 */
export type VoiceRecognitionErrorCode =
  | 'NOT_SUPPORTED'
  | 'PERMISSION_DENIED'
  | 'MICROPHONE_UNAVAILABLE'
  | 'NO_SPEECH'
  | 'NETWORK_ERROR'
  | 'SERVICE_ERROR'
  | 'ABORTED'
  | 'UNKNOWN_ERROR';

export interface VoiceRecognitionError {
  code: VoiceRecognitionErrorCode;
  message: string;
  technicalDetails?: string;
}

/**
 * Voice Recognition Service Callback Handlers
 */
export interface VoiceRecognitionCallbacks {
  onStateChange?: (state: VoiceState) => void;
  onInterimTranscript?: (transcript: string) => void;
  onFinalTranscript?: (transcript: string) => void;
  onError?: (error: VoiceRecognitionError) => void;
  onEnd?: () => void;
}
