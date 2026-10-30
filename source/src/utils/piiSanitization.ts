import { usePIIStore, PIIEntry } from '../store/piiStore';
import { Content, Part } from '@google/genai';
import { replaceWholeWords, MaskPair } from './piiMasking';

/**
 * Sanitizes a single string by replacing original terms (and their variations)
 * with their placeholders. Whole words only: a stakeholder named "Rose" never
 * touches "arose". See piiMasking.ts.
 */
export function sanitizeString(text: string, entries: PIIEntry[]): string {
  if (!text) return text;
  const pairs: MaskPair[] = [];
  for (const entry of entries) {
    if (!entry.placeholder) continue;
    if (entry.originalTerm) pairs.push({ find: entry.originalTerm, replace: entry.placeholder });
    if (Array.isArray(entry.variations)) {
      for (const v of entry.variations) {
        if (v && v.trim()) pairs.push({ find: v.trim(), replace: entry.placeholder });
      }
    }
  }
  return replaceWholeWords(text, pairs, true);
}

/**
 * Reconstructs a single string by replacing placeholders with their original
 * terms. Case-sensitive, whole words only, one pass.
 */
export function reconstructString(text: string, entries: PIIEntry[]): string {
  if (!text) return text;
  const pairs: MaskPair[] = entries
    .filter((e) => e.originalTerm && e.placeholder)
    .map((e) => ({ find: e.placeholder, replace: e.originalTerm }));
  return replaceWholeWords(text, pairs, false);
}

/**
 * Sanitizes any value (flat or nested object/array) recursively.
 */
export function sanitizeValue(val: any, entries: PIIEntry[]): any {
  if (typeof val === 'string') {
    return sanitizeString(val, entries);
  }
  if (Array.isArray(val)) {
    return val.map(item => sanitizeValue(item, entries));
  }
  if (val !== null && typeof val === 'object') {
    const res: any = {};
    for (const key of Object.keys(val)) {
      res[key] = sanitizeValue(val[key], entries);
    }
    return res;
  }
  return val;
}

/**
 * Reconstructs any value (flat or nested object/array) recursively.
 */
export function reconstructValue(val: any, entries: PIIEntry[]): any {
  if (typeof val === 'string') {
    return reconstructString(val, entries);
  }
  if (Array.isArray(val)) {
    return val.map(item => reconstructValue(item, entries));
  }
  if (val !== null && typeof val === 'object') {
    const res: any = {};
    for (const key of Object.keys(val)) {
      res[key] = reconstructValue(val[key], entries);
    }
    return res;
  }
  return val;
}

/**
 * Sanitizes an array of Gemini Content messages before sending them to the LLM.
 */
export function sanitizeContentHistory(history: Content[], projectId: string): Content[] {
  const entries = usePIIStore.getState().entries.filter(e => e.projectId === projectId);
  if (entries.length === 0) return history;

  return history.map(message => {
    const newParts = (message.parts || []).map(part => {
      const newPart: any = { ...part };
      
      if (typeof newPart.text === 'string') {
        newPart.text = sanitizeString(newPart.text, entries);
      }

      if (typeof newPart._filename === 'string') {
        newPart._filename = sanitizeString(newPart._filename, entries);
      }

      if (typeof newPart._extractedText === 'string') {
        newPart._extractedText = sanitizeString(newPart._extractedText, entries);
      }

      if (newPart.functionCall && newPart.functionCall.args) {
        newPart.functionCall.args = sanitizeValue(newPart.functionCall.args, entries);
      }

      if (newPart.functionResponse && newPart.functionResponse.response) {
        newPart.functionResponse.response = sanitizeValue(newPart.functionResponse.response, entries);
      }
      
      return newPart as Part;
    });

    return {
      ...message,
      parts: newParts
    };
  });
}

/**
 * Reconstructs an array of Gemini Content messages received from the LLM.
 * (Although generally we can just reconstruct the string directly)
 */
export function reconstructParts(parts: Part[], projectId: string): Part[] {
  const entries = usePIIStore.getState().entries.filter(e => e.projectId === projectId);
  if (entries.length === 0) return parts;

  return parts.map(part => {
    const newPart: any = { ...part };
    
    if (typeof newPart.text === 'string') {
      newPart.text = reconstructString(newPart.text, entries);
    }

    if (typeof newPart._filename === 'string') {
      newPart._filename = reconstructString(newPart._filename, entries);
    }

    if (typeof newPart._extractedText === 'string') {
      newPart._extractedText = reconstructString(newPart._extractedText, entries);
    }

    if (newPart.functionCall && newPart.functionCall.args) {
      newPart.functionCall.args = reconstructValue(newPart.functionCall.args, entries);
    }

    if (newPart.functionResponse && newPart.functionResponse.response) {
      newPart.functionResponse.response = reconstructValue(newPart.functionResponse.response, entries);
    }
    
    return newPart as Part;
  });
}
