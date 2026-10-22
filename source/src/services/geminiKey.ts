/**
 * The Gemini key setting. PLAN.md section 22.4.
 *
 * The key is typed into the app (setup wizard or Settings → Gemini) and sent
 * ONCE to the local server (source/server.mjs), which checks it with Google,
 * keeps it on this computer and adds it to every Gemini call. The server never
 * sends it back: the page only learns whether a key is set, where it came
 * from, and its last four characters.
 *
 * Rules for anyone editing the app:
 *  - Never keep the key in the page: not in a store, localStorage, IndexedDB,
 *    the Sheet or a log. Clear the input once it is saved.
 *  - Talk to the server only through these three functions.
 */

export interface GeminiKeyStatus {
  configured: boolean;
  /** 'app' = saved in PM Codex; 'pinokio' = Pinokio's ENVIRONMENT (older installs). */
  source: 'app' | 'pinokio' | null;
  last4: string | null;
}

const KEY_SETTINGS_PATH = '/api/settings/gemini-key';

async function call(method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<GeminiKeyStatus> {
  let res: Response;
  try {
    res = await fetch(KEY_SETTINGS_PATH, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the PM Codex server on this computer. Is the app running in Pinokio?');
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !data || typeof data.configured !== 'boolean') {
    const message = data?.error?.message;
    throw new Error(typeof message === 'string' && message ? message : `The PM Codex server answered ${res.status}. Restart the app in Pinokio and try again.`);
  }
  return data as GeminiKeyStatus;
}

export const getGeminiKeyStatus = () => call('GET');
/** Checks the key with Google, then saves it. Rejects with a plain sentence. */
export const saveGeminiKey = (key: string) => call('POST', { key: key.trim() });
/** Removes the key saved in the app. A key in Pinokio's settings stays. */
export const removeGeminiKey = () => call('DELETE');
