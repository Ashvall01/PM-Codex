import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DateVisualizer, isLikelyDateString, parseDateSafely } from './DateVisualizer';
import { transformDateTagsToMarkdown } from './layout/AIResponseRenderer';

interface RichTextViewerProps {
  content: string;
  className?: string;
  placeholder?: string;
}

export function isHTML(str: string): boolean {
  if (!str) return false;
  // Detect standard HTML tags like <p>, <h1>, <h2>, <ul>, <li>, <table, <strong, <em etc.
  const htmlRegex = /<[a-z][\s\S]*>/i;
  return htmlRegex.test(str);
}

/**
 * Colours and fonts that text brought along from somewhere else — an email, a
 * Word document, an earlier editor — and that fight the page's own look: black
 * and near-black text, white backgrounds, a font family, a fixed size. Only
 * the display is cleaned; what is stored stays exactly as it was. Colours the
 * editor itself offers (orange, magenta, cyan …) are kept.
 */
const FOREIGN_COLOUR = /^(black|windowtext|#0{3}|#0{6}|#1{3}|#1{6}|#2{3}|#2{6}|#333(333)?|rgba?\(\s*(\d|[1-4]\d)\s*,\s*(\d|[1-4]\d)\s*,\s*(\d|[1-4]\d)\s*(,\s*[\d.]+\s*)?\))$/i;
const PLAIN_BACKGROUND = /^(white|#fff(fff)?|transparent|rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(,\s*[\d.]+\s*)?\))$/i;

export function normalizeForeignStyles(html: string): string {
  if (!/style=|<font/i.test(html) || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return html;
  root.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    const kept = (el.getAttribute('style') || '')
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .filter((d) => {
        const i = d.indexOf(':');
        if (i < 0) return false;
        const prop = d.slice(0, i).trim().toLowerCase();
        const value = d.slice(i + 1).replace(/!important/i, '').trim();
        if (prop === 'color') return !FOREIGN_COLOUR.test(value);
        if (prop === 'background' || prop === 'background-color') return !PLAIN_BACKGROUND.test(value);
        if (prop === 'font-family' || prop === 'font-size' || prop === 'line-height') return false;
        return true;
      });
    if (kept.length) el.setAttribute('style', kept.join('; '));
    else el.removeAttribute('style');
  });
  root.querySelectorAll('font').forEach((el) => {
    const colour = el.getAttribute('color') || '';
    if (FOREIGN_COLOUR.test(colour.trim())) el.removeAttribute('color');
    el.removeAttribute('face');
    el.removeAttribute('size');
  });
  return root.innerHTML;
}

export const RichTextViewer: React.FC<RichTextViewerProps> = ({ 
  content, 
  className = '', 
  placeholder = '' 
}) => {
  const hasHTML = isHTML(content || '');
  const html = React.useMemo(() => (hasHTML ? normalizeForeignStyles(content) : ''), [content, hasHTML]);

  if (!content || content.trim() === '') {
    if (placeholder) {
      return <div className="text-qb-grey italic text-sm">{placeholder}</div>;
    }
    return null;
  }

  // HTML and Markdown get the same wrapper and the same look (index.css,
  // .qb-prose). Callers add size or weight, never colours.
  const wrapper = `prose qb-prose ${className}`;

  if (hasHTML) {
    return (
      <div 
        className={`${wrapper} qb-rich-view`} 
        dangerouslySetInnerHTML={{ __html: html }} 
      />
    );
  }

  const processedContent = transformDateTagsToMarkdown(content);

  return (
    <div className={`${wrapper} qb-markdown-view`}>
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({node, href, children, ...props}: any) => {
            const textContent = typeof children === 'string'
              ? children
              : (Array.isArray(children)
                  ? children.map(c => typeof c === 'string' ? c : '').join('')
                  : '');
            
            const isDate = href && (
              href.startsWith('date:') ||
              href.startsWith('#date:') ||
              isLikelyDateString(href.replace(/^(https?:\/\/)?#?date:/i, '').trim())
            ) || isLikelyDateString(textContent);

            if (isDate) {
              let rawDate = href ? href.replace(/^(https?:\/\/)?#?date:/i, '').trim() : '';
              if (!rawDate || !parseDateSafely(rawDate)) {
                rawDate = textContent;
              }
              return (
                <DateVisualizer date={rawDate} className="inline-flex items-baseline align-baseline mx-0.5">
                  <span 
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold bg-white text-qb-black px-1.5 py-0.5 border border-qb-light-grey hover:border-qb-orange hover:text-qb-orange hover:bg-qb-orange/5 transition-all cursor-pointer select-none shadow-xs"
                  >
                    <span className="w-1.5 h-1.5 bg-[#2dbcd2] shrink-0" />
                    <span>{children}</span>
                  </span>
                </DateVisualizer>
              );
            }

            const isInternal = href && (href.startsWith('/') || href.startsWith('#'));
            if (isInternal) {
              return (
                <span 
                  className="text-qb-orange decoration-qb-light-grey hover:decoration-qb-orange hover:text-qb-black underline transition-colors font-bold cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                  }}
                >
                  {children}
                </span>
              );
            }

            return (
              <a 
                className="text-qb-orange hover:text-qb-black underline font-bold transition-colors" 
                target="_blank" 
                rel="noopener noreferrer" 
                href={href}
                {...props}
              >
                {children}
              </a>
            );
          }
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
};
