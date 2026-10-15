import { usePIIStore, PIIEntry } from '../store/piiStore';
import { Content, Part } from '@google/genai';

/**
 * Escapes special characters in a string to be used safely in a RegExp.
 */
function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitizes a single string by replacing original terms with their placeholders.
 */
export function sanitizeString(text: string, entries: PIIEntry[]): string {
  if (!text) return text;
  let sanitizedText = text;
  
  interface MatchItem {
    term: string;
    placeholder: string;
  }

  const matches: MatchItem[] = [];
  for (const entry of entries) {
    if (entry.placeholder) {
      if (entry.originalTerm) {
        matches.push({ term: entry.originalTerm, placeholder: entry.placeholder });
      }
      if (entry.variations && Array.isArray(entry.variations)) {
        entry.variations.forEach(v => {
          if (v && v.trim()) {
            matches.push({ term: v.trim(), placeholder: entry.placeholder });
          }
        });
      }
    }
  }

  // Sort matches by term length descending to match longer phrases first
  const sortedMatches = matches.sort((a, b) => b.term.length - a.term.length);

  for (const match of sortedMatches) {
    const regex = new RegExp(escapeRegExp(match.term), 'gi');
    sanitizedText = sanitizedText.replace(regex, match.placeholder);
  }
  return sanitizedText;
}

/**
 * Reconstructs a single string by replacing placeholders with their original terms.
 */
export function reconstructString(text: string, entries: PIIEntry[]): string {
  if (!text) return text;
  let reconstructedText = text;

  // Sort entries by placeholder length descending just in case
  const sortedEntries = [...entries].sort((a, b) => b.placeholder.length - a.placeholder.length);

  for (const entry of sortedEntries) {
    if (entry.originalTerm && entry.placeholder) {
      const regex = new RegExp(escapeRegExp(entry.placeholder), 'g');
      reconstructedText = reconstructedText.replace(regex, entry.originalTerm);
    }
  }
  return reconstructedText;
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
