import React from 'react';
import { isRemoteImage } from '../utils/safeHtml';

/**
 * How Markdown shows an image: `![alt](address)`.
 *
 * An image from another site is fetched the moment it is displayed, and its
 * address can carry anything the writer put into it. Markdown here is written
 * by assistants (chat replies, proposed pages), and text an assistant has read
 * can talk it into writing such an address. So a remote image is shown as a
 * link the user may open, never loaded by itself. An image embedded in the
 * text (data:) fetches nothing and is shown. See utils/safeHtml.ts.
 */
export const MarkdownImage: React.FC<{ src?: string; alt?: string }> = ({ src, alt }) => {
  const address = String(src || '').trim();
  if (address && !isRemoteImage(address)) {
    return <img src={address} alt={alt || ''} className="max-w-full h-auto inline-block" />;
  }
  const label = `[image${alt ? `: ${alt}` : ''}]`;
  if (!/^https?:\/\//i.test(address)) return <span className="text-qb-grey">{label}</span>;
  return (
    <a
      href={address}
      target="_blank"
      rel="noopener noreferrer"
      title="An image from another site. It is not loaded until you open it."
      className="text-qb-orange hover:text-qb-black underline font-bold transition-colors"
    >
      {label}
    </a>
  );
};
