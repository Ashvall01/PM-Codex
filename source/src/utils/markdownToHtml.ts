/**
 * Utility to convert Markdown formatted text into clean, safe HTML
 * suitable for rich text editors (like Tiptap / ProseMirror) and viewers.
 */

export function isHtml(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  return (
    (trimmed.startsWith('<p') ||
      trimmed.startsWith('<div') ||
      trimmed.startsWith('<h') ||
      trimmed.startsWith('<ul') ||
      trimmed.startsWith('<ol') ||
      trimmed.startsWith('<table') ||
      trimmed.startsWith('<blockquote')) &&
    trimmed.endsWith('>')
  );
}

export function markdownToHtml(markdown: string): string {
  if (!markdown) return '';
  
  // If it already looks like rich HTML, check if it contains unparsed markdown blocks
  let text = markdown;

  // Normalize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Handle fenced code blocks: ```lang\ncode\n```
  text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<pre><code>${escaped}</code></pre>`;
  });

  // Handle tables:
  // | Header 1 | Header 2 |
  // |----------|----------|
  // | Cell 1   | Cell 2   |
  text = text.replace(/(?:^|\n)(\|.+?\|\n\|[-:\s|]+?\|\n(?:\|.+?\|\n?)+)/g, (match) => {
    const lines = match.trim().split('\n').filter(Boolean);
    if (lines.length < 2) return match;

    const headerLine = lines[0];
    const headerCols = headerLine.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
    
    let tableHtml = '<table border="1" style="border-collapse: collapse; width: 100%; margin: 12px 0;"><thead><tr>';
    headerCols.forEach(col => {
      tableHtml += `<th style="padding: 6px 10px; text-align: left; background: #f0f0f0;">${parseInlineMarkdown(col)}</th>`;
    });
    tableHtml += '</tr></thead><tbody>';

    for (let i = 2; i < lines.length; i++) {
      const rowCols = lines[i].split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      tableHtml += '<tr>';
      rowCols.forEach(col => {
        tableHtml += `<td style="padding: 6px 10px;">${parseInlineMarkdown(col)}</td>`;
      });
      tableHtml += '</tr>';
    }

    tableHtml += '</tbody></table>';
    return `\n\n${tableHtml}\n\n`;
  });

  // Split into block segments by double newlines
  const rawBlocks = text.split(/\n\s*\n/);
  const processedBlocks: string[] = [];

  for (const block of rawBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // If block is already a full HTML tag like <pre>, <table>, <div>, <p>
    if (/^<(pre|table|blockquote|ul|ol|h[1-6]|div|p)[\s>]/i.test(trimmed)) {
      processedBlocks.push(trimmed);
      continue;
    }

    const lines = trimmed.split('\n');

    // 1. Headings (# Heading, ## Heading, etc.)
    if (/^#{1,6}\s+/.test(lines[0])) {
      const headingMatch = lines[0].match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = parseInlineMarkdown(headingMatch[2].trim());
        processedBlocks.push(`<h${level}>${headingText}</h${level}>`);
        // If there were subsequent lines, process them as paragraph
        if (lines.length > 1) {
          const rest = lines.slice(1).join('\n');
          processedBlocks.push(markdownToHtml(rest));
        }
        continue;
      }
    }

    // 2. Blockquote (> Quote)
    if (lines.every(l => l.trim().startsWith('>'))) {
      const quoteContent = lines.map(l => l.trim().replace(/^>\s?/, '')).join('\n');
      processedBlocks.push(`<blockquote>${parseInlineMarkdown(quoteContent)}</blockquote>`);
      continue;
    }

    // 3. Horizontal rule (--- or *** or ___)
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      processedBlocks.push('<hr />');
      continue;
    }

    // 4. Unordered List (- item or * item or + item)
    if (lines.some(l => /^\s*[-*+]\s+/.test(l))) {
      let listHtml = '<ul>';
      let inList = false;
      for (const line of lines) {
        const match = line.match(/^\s*[-*+]\s+(.*)$/);
        if (match) {
          listHtml += `<li>${parseInlineMarkdown(match[1].trim())}</li>`;
          inList = true;
        } else if (inList) {
          // Multiline list item continuation
          listHtml = listHtml.replace(/<\/li>$/, ` ${parseInlineMarkdown(line.trim())}</li>`);
        } else {
          listHtml += `<li>${parseInlineMarkdown(line.trim())}</li>`;
        }
      }
      listHtml += '</ul>';
      processedBlocks.push(listHtml);
      continue;
    }

    // 5. Ordered List (1. item, 2. item)
    if (lines.some(l => /^\s*\d+\.\s+/.test(l))) {
      let listHtml = '<ol>';
      let inList = false;
      for (const line of lines) {
        const match = line.match(/^\s*\d+\.\s+(.*)$/);
        if (match) {
          listHtml += `<li>${parseInlineMarkdown(match[1].trim())}</li>`;
          inList = true;
        } else if (inList) {
          listHtml = listHtml.replace(/<\/li>$/, ` ${parseInlineMarkdown(line.trim())}</li>`);
        } else {
          listHtml += `<li>${parseInlineMarkdown(line.trim())}</li>`;
        }
      }
      listHtml += '</ol>';
      processedBlocks.push(listHtml);
      continue;
    }

    // 6. Regular Paragraph
    const paragraphLines = lines.map(l => parseInlineMarkdown(l.trim())).join('<br />');
    processedBlocks.push(`<p>${paragraphLines}</p>`);
  }

  return processedBlocks.join('\n');
}

/**
 * Parses inline markdown tags: bold, italic, code, strikethrough, links, date tags
 */
export function parseInlineMarkdown(text: string): string {
  if (!text) return '';
  let str = text;

  // Escape raw HTML characters only if not already part of an HTML tag
  // Handle inline code: `code`
  str = str.replace(/`([^`]+)`/g, (_m, code) => {
    const escaped = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<code>${escaped}</code>`;
  });

  // Handle Bold: **bold** or __bold__
  str = str.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  str = str.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Handle Italic: *italic* or _italic_
  str = str.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  str = str.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Handle Strikethrough: ~~strike~~
  str = str.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // Handle Links: [label](url)
  str = str.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  return str;
}

/**
 * Standardizes meeting text / agenda / notes / key decisions into HTML.
 * If already well-formed HTML, returns cleaned version; otherwise converts Markdown to HTML.
 */
export function formatMeetingContentToHtml(content: string | undefined | null): string {
  if (!content) return '';
  const trimmed = content.trim();
  if (!trimmed) return '';

  if (isHtml(trimmed)) {
    return trimmed;
  }

  return markdownToHtml(trimmed);
}
