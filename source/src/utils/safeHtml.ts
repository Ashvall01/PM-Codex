/**
 * RICH TEXT IS UNTRUSTED.
 *
 * Minutes, Codex pages and meeting notes are stored as HTML and shown with
 * innerHTML. That HTML does not only come from the user's own typing: an
 * assistant proposes it (and the review panel shows the proposal BEFORE
 * sign-off), and it is read back from the Google Sheet, which anyone holding
 * the web app address can write to. Text an assistant has read — a meeting
 * transcript, a chat export, an attached document — can carry instructions
 * that make it write hostile HTML ("prompt injection").
 *
 * Unfiltered, such HTML could run script in the app's own page
 * (`<img src=x onerror=…>`): read every project, the Sheet's address, and spend
 * the Gemini key through the local server. And with no script at all, an
 * image or a CSS `url(…)` pointing at another site sends whatever is written
 * into its address the moment it is displayed.
 *
 * So everything shown through innerHTML passes through sanitizeRichHtml:
 *   - DOMPurify removes script, event handlers and `javascript:` addresses;
 *   - forms, <style> blocks, frames, SVG and media are not rich text here;
 *   - an image that would be fetched from another site becomes a link the
 *     user can choose to open (images embedded as data: are shown);
 *   - a style declaration that fetches something (`url(…)`) is dropped;
 *   - links open in a new tab without handing over the opener.
 *
 * Only what is DISPLAYED is filtered. The stored text is never rewritten.
 */
import DOMPurify from 'dompurify';

const FORBID_TAGS = [
  'style', 'form', 'input', 'button', 'select', 'option', 'textarea', 'label',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'audio', 'video', 'source', 'track',
  'link', 'meta', 'base', 'dialog', 'template', 'slot', 'marquee',
];

/** A style declaration that makes the browser fetch something, or runs code. */
const FETCHING_STYLE = /url\s*\(|image-set\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding/i;
/** Pictures carried inside the text itself — nothing is fetched to show them. */
const EMBEDDED_IMAGE = /^data:image\/(png|jpe?g|gif|webp|bmp);/i;

/** True when showing this image address would contact another site. */
export function isRemoteImage(src: string | null | undefined): boolean {
  return !EMBEDDED_IMAGE.test(String(src || '').trim());
}

let hooked = false;
function installHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
    if (!node || typeof node.getAttribute !== 'function') return;

    const style = node.getAttribute('style');
    if (style && FETCHING_STYLE.test(style)) {
      const kept = style.split(';').map((d) => d.trim()).filter((d) => d && !FETCHING_STYLE.test(d));
      if (kept.length) node.setAttribute('style', kept.join('; '));
      else node.removeAttribute('style');
    }
    // Presentational attributes that carry an address of their own.
    if (node.hasAttribute('background')) node.removeAttribute('background');

    const tag = node.tagName;
    if (tag === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
    if (tag === 'IMG') {
      node.removeAttribute('srcset');
      const src = node.getAttribute('src') || '';
      if (isRemoteImage(src)) {
        const doc = node.ownerDocument;
        const alt = (node.getAttribute('alt') || '').trim();
        const label = `[image${alt ? `: ${alt}` : ''}]`;
        let stand: Element;
        if (/^https?:\/\//i.test(src.trim())) {
          stand = doc.createElement('a');
          stand.setAttribute('href', src.trim());
          stand.setAttribute('target', '_blank');
          stand.setAttribute('rel', 'noopener noreferrer');
          stand.setAttribute('title', 'An image from another site. It is not loaded until you open it.');
        } else {
          stand = doc.createElement('span');
        }
        stand.textContent = label;
        node.parentNode?.replaceChild(stand, node);
      }
    }
  });
}

/** HTML that is safe to put on the page with innerHTML. See the note above. */
export function sanitizeRichHtml(html: string | null | undefined): string {
  if (!html) return '';
  // No DOM (a Node test of a module that imports this): there is no page to
  // protect and nothing to parse with. The browser always has one.
  if (typeof window === 'undefined' || !DOMPurify.isSupported) return String(html);
  installHooks();
  return DOMPurify.sanitize(String(html), {
    USE_PROFILES: { html: true },
    FORBID_TAGS,
    FORBID_ATTR: ['srcset', 'ping', 'formaction', 'action', 'poster'],
    ALLOW_DATA_ATTR: true,
  }) as unknown as string;
}

/** The plain text of some rich text, without putting it on the page. */
export function richTextToPlain(html: string | null | undefined): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') return String(html).replace(/<[^>]*>/g, '');
  // A parsed document that is never displayed loads nothing and runs nothing —
  // unlike a detached <div>, whose innerHTML still fetches images and fires
  // their error handlers.
  return new DOMParser().parseFromString(String(html), 'text/html').body.textContent || '';
}
