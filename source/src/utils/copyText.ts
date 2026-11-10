/**
 * Copy text to the clipboard, and say truthfully whether it worked.
 *
 * `navigator.clipboard.writeText` returns a promise that is refused when the
 * page is not focused or the browser withholds the permission. The copy
 * buttons used to ignore that and show "Copied" regardless — in the setup
 * wizard that meant pasting whatever was on the clipboard before into Apps
 * Script. This tries the modern way, then the older one, and returns the truth.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the older way */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    Object.assign(area.style, { position: 'fixed', top: '0', left: '-9999px', opacity: '0' });
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand('copy');
    area.remove();
    return done;
  } catch {
    return false;
  }
}
