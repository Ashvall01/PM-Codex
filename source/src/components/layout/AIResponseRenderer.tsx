import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DateVisualizer, isLikelyDateString, parseDateSafely } from '../DateVisualizer';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  variant?: 'default' | 'mono';
}

export function transformDateTagsToMarkdown(rawContent: string): string {
  if (!rawContent) return '';
  let text = rawContent;

  // Stash code blocks to avoid transforming dates inside code or code blocks
  const codeBlocks: string[] = [];
  text = text.replace(/(```[\s\S]*?```|`[^`]+`)/g, (m) => {
    codeBlocks.push(m);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // 1. <date date="YYYY-MM-DD">Display Date</date> or <date value="YYYY-MM-DD">Display Date</date>
  text = text.replace(/<date\s+(?:date|value)=["']([^"']+)["']\s*>([\s\S]*?)<\/date>/gi, (_match, dateVal, label) => {
    const trimmedLabel = label.trim() || dateVal.trim();
    return `[${trimmedLabel}](date:${dateVal.trim()})`;
  });

  // 2. <date date="YYYY-MM-DD"/> or <date value="YYYY-MM-DD"/>
  text = text.replace(/<date\s+(?:date|value)=["']([^"']+)["']\s*\/>/gi, (_match, dateVal) => {
    const trimmed = dateVal.trim();
    return `[${trimmed}](date:${trimmed})`;
  });

  // 3. <date>YYYY-MM-DD</date> or <date>Display text</date>
  text = text.replace(/<date>([\s\S]*?)<\/date>/gi, (_match, dateVal) => {
    const trimmed = dateVal.trim();
    return `[${trimmed}](date:${trimmed})`;
  });

  // 4. [date: YYYY-MM-DD | Display Date] or [date: YYYY-MM-DD]
  text = text.replace(/\[date:\s*([^\]|]+?)(?:\s*\|\s*([^\]]+?))?\]/gi, (_match, dateVal, label) => {
    const trimmedDate = dateVal.trim();
    const trimmedLabel = (label && label.trim()) || trimmedDate;
    return `[${trimmedLabel}](date:${trimmedDate})`;
  });

  // 5. @date(YYYY-MM-DD)
  text = text.replace(/@date\(([^)]+)\)/gi, (_match, dateVal) => {
    const trimmed = dateVal.trim();
    return `[${trimmed}](date:${trimmed})`;
  });

  // 6. Generic markdown links where the label OR destination is a date:
  // e.g. [16 Jun 2026](/timeline), [2026-06-16](/timeline), [16 Jun 2026](https://.../timeline), [Display Date](2026-06-16)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, dest) => {
    const trimmedLabel = label.trim();
    const trimmedDest = dest.trim();

    if (trimmedDest.startsWith('date:')) {
      return match;
    }

    if (isLikelyDateString(trimmedDest)) {
      return `[${trimmedLabel}](date:${trimmedDest})`;
    }

    if (isLikelyDateString(trimmedLabel)) {
      return `[${trimmedLabel}](date:${trimmedLabel})`;
    }

    return match;
  });

  // 7. Auto-detect unlinked dates in plain text
  // Match ISO YYYY-MM-DD (e.g. 2026-08-25) not already in markdown links
  text = text.replace(/(?<!\[[^\]]*)(?<!\()(20\d{2}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01]))(?!\))/g, (m) => {
    return `[${m}](date:${m})`;
  });

  // Match "16 Jun 2026" or "16 June 2026"
  text = text.replace(/(?<!\[[^\]]*)(?<!\()(\b(?:0?[1-9]|[12]\d|3[01])\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d{2}\b)(?!\))/gi, (m) => {
    return `[${m}](date:${m})`;
  });

  // Match "June 16, 2026" or "Jun 16 2026"
  text = text.replace(/(?<!\[[^\]]*)(?<!\()(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:0?[1-9]|[12]\d|3[01]),?\s+20\d{2}\b)(?!\))/gi, (m) => {
    return `[${m}](date:${m})`;
  });

  // Restore code blocks
  text = text.replace(/__CODE_BLOCK_(\d+)__/g, (_m, idx) => {
    return codeBlocks[parseInt(idx, 10)] || '';
  });

  return text;
}

const isDateHref = (href?: string, textContent?: string): boolean => {
  if (href) {
    const clean = href.trim();
    if (
      clean.startsWith('date:') ||
      clean.startsWith('#date:') ||
      clean.startsWith('http://date:') ||
      clean.startsWith('https://date:') ||
      /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(clean)
    ) {
      return true;
    }
    if (isLikelyDateString(clean)) {
      return true;
    }
  }

  if (textContent && isLikelyDateString(textContent)) {
    return true;
  }

  return false;
};

const extractDateString = (href?: string, fallbackText?: string): string => {
  if (href) {
    let clean = href.trim();
    clean = clean.replace(/^(https?:\/\/)?#?date:/i, '').trim();
    if (isLikelyDateString(clean) && parseDateSafely(clean)) {
      return clean;
    }
  }
  if (fallbackText && isLikelyDateString(fallbackText)) {
    return fallbackText.trim();
  }
  return fallbackText || href || '';
};

export const AIResponseRenderer: React.FC<MarkdownRendererProps> = ({ content, className, variant = 'default' }) => {
  const isMono = variant === 'mono';
  const processedContent = transformDateTagsToMarkdown(content || '');
  
  const MarkdownComponents = {
    h1: ({node, ...props}: any) => <h1 className={`${isMono ? 'text-xs' : 'text-sm'} font-black uppercase tracking-widest ${isMono ? 'text-qb-grey' : 'text-qb-black'} mt-5 mb-3 border-b border-qb-light-grey pb-1`} {...props} />,
    h2: ({node, ...props}: any) => <h2 className={`${isMono ? 'text-xs' : 'text-sm'} font-black uppercase tracking-widest ${isMono ? 'text-qb-grey' : 'text-qb-black'} mt-4 mb-2`} {...props} />,
    h3: ({node, ...props}: any) => <h3 className={`text-xs font-black uppercase tracking-widest text-qb-dark-grey mt-3 mb-1`} {...props} />,
    p: ({node, ...props}: any) => <p className={`leading-relaxed ${isMono ? 'text-inherit' : 'text-qb-black'} my-2 ${isMono ? 'text-xs' : 'text-sm'}`} {...props} />,
    ul: ({node, ...props}: any) => <ul className={`list-disc pl-4 my-2 space-y-1 ${isMono ? 'text-xs text-inherit' : 'text-sm text-qb-black'} marker:text-qb-orange`} {...props} />,
    ol: ({node, ...props}: any) => <ol className={`list-decimal pl-4 my-2 space-y-1 ${isMono ? 'text-xs text-inherit' : 'text-sm text-qb-black'} marker:text-qb-orange`} {...props} />,
    li: ({node, ...props}: any) => <li className="pl-1" {...props} />,
    a: ({node, href, children, ...props}: any) => {
      const textContent = typeof children === 'string'
        ? children
        : (Array.isArray(children)
            ? children.map(c => typeof c === 'string' ? c : '').join('')
            : '');
      const isDate = isDateHref(href, textContent);
      if (isDate) {
        const rawDate = extractDateString(href, textContent);
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

      // If it's an internal route link (e.g. /timeline, /tasks), don't open in a new tab
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
          className={`${isMono ? 'text-inherit decoration-qb-grey' : 'text-qb-orange decoration-qb-light-grey hover:decoration-qb-orange'} hover:text-qb-black underline transition-colors font-bold`} 
          target="_blank" 
          rel="noopener noreferrer" 
          href={href}
          {...props}
        >
          {children}
        </a>
      );
    },
    strong: ({node, ...props}: any) => <strong className={`font-bold ${isMono ? 'text-inherit' : 'text-qb-black'} focus:outline-none`} {...props} />,
    blockquote: ({node, ...props}: any) => <blockquote className={`border-l-2 ${isMono ? 'border-qb-grey text-qb-grey bg-black/5' : 'border-qb-orange text-qb-dark-grey bg-qb-orange/5'} italic my-3 py-2 pl-4 pr-4 ${isMono ? 'text-xs' : 'text-sm'}`} {...props} />,
    pre: ({node, ...props}: any) => <pre className={`bg-qb-black text-qb-box-bg p-4 font-mono text-[11.5px] leading-relaxed overflow-x-auto whitespace-pre rounded-none my-4 border-l-2 ${isMono ? 'border-qb-grey' : 'border-qb-orange'} [&>code]:bg-transparent [&>code]:border-none [&>code]:text-inherit [&>code]:p-0`} {...props} />,
    code: ({node, className: codeClass, ...props}: any) => {
      return <code className={`${codeClass || ''} ${isMono ? 'bg-black/5' : 'bg-qb-light-grey/30'} border border-qb-light-grey ${isMono ? 'text-inherit' : 'text-qb-black'} px-1.5 py-0.5 font-mono text-[11px]`} {...props} />
    },
    hr: ({node, ...props}: any) => <hr className="my-6 border-t border-qb-light-grey" {...props} />,
    table: ({node, ...props}: any) => <div className="overflow-x-auto my-4"><table className={`min-w-full ${isMono ? 'text-xs' : 'text-sm'} text-left border-collapse border border-qb-light-grey`} {...props} /></div>,
    thead: ({node, ...props}: any) => <thead className="bg-qb-box-bg uppercase text-[10px] tracking-widest text-qb-grey border-b border-qb-light-grey" {...props} />,
    tbody: ({node, ...props}: any) => <tbody className="divide-y divide-qb-light-grey bg-transparent" {...props} />,
    tr: ({node, ...props}: any) => <tr className="hover:bg-qb-light-grey/20 transition-colors" {...props} />,
    th: ({node, ...props}: any) => <th className={`px-3 py-2 font-bold ${isMono ? 'text-inherit' : 'text-qb-black'} border-r border-qb-light-grey last:border-r-0`} {...props} />,
    td: ({node, ...props}: any) => <td className="px-3 py-2 border-r border-qb-light-grey last:border-r-0 text-qb-dark-grey" {...props} />,
  };

  return (
    <div className={`markdown-body ${isMono ? 'font-mono text-xs' : 'font-sans text-sm'} selection:bg-qb-orange selection:text-white [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${className || ''}`}>
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]} 
        components={MarkdownComponents}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
};
