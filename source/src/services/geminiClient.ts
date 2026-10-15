/**
 * The one Gemini client for the whole app. PLAN.md section 22.4.
 *
 * The page never holds the real Gemini API key. Every call goes to the local
 * server (source/server.mjs) at /api/gemini on the page's own address; the
 * server adds the key and forwards the call to Google. The key below is a
 * placeholder the server throws away.
 *
 * Rules for anyone editing the app:
 *  - Make Gemini calls through `gemini` (or `createGeminiClient()`), never
 *    `new GoogleGenAI({ apiKey: ... })` with a real key.
 *  - Never add a `define` for an API key to vite.config.ts. Pinokio puts the
 *    key in the environment of every script, so a define would bake it into
 *    the page. server.mjs refuses to start if it finds the key in the build.
 *
 * Gemini is optional. Without a key the server answers 503, and
 * geminiErrorText() turns that into one plain sentence for the user.
 */
import { GoogleGenAI } from '@google/genai';

export const GEMINI_PROXY_PATH = '/api/gemini';
const PLACEHOLDER_KEY = 'pm-codex-local';

export function createGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: PLACEHOLDER_KEY,
    httpOptions: { baseUrl: `${window.location.origin}${GEMINI_PROXY_PATH}` },
  });
}

export const gemini = createGeminiClient();

/**
 * One readable sentence for a failed Gemini call. The SDK packs the server's
 * whole JSON answer into Error.message; this pulls the message back out.
 */
export function geminiErrorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  try {
    const parsed = JSON.parse(raw);
    const inner = parsed?.error?.message;
    if (typeof inner === 'string' && inner.trim()) return inner.trim();
  } catch {
    /* not JSON — use it as it is */
  }
  return raw;
}

/** True when the local server says no Gemini key is set. */
export function isGeminiKeyMissing(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 503 && /no gemini api key/i.test(geminiErrorText(err));
}
