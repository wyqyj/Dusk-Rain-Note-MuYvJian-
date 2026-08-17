import DOMPurify from 'dompurify';

const ALLOWED_TAGS = new Set([
  'a', 'blockquote', 'br', 'code', 'col', 'colgroup', 'del', 'details', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'img', 'input', 'li', 'ol', 'p', 'pre', 's', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'svg', 'line', 'path', 'g', 'annotation', 'semantics', 'math', 'mi', 'mn',
  'mo', 'mrow', 'msup', 'mfrac', 'mtext', 'mspace',
]);

const ALLOWED_ATTRIBUTES = new Set([
  'alt', 'aria-hidden', 'aria-label', 'checked', 'class', 'data-title', 'd', 'disabled', 'fill', 'height', 'href', 'id', 'name', 'role', 'src', 'stroke',
  'stroke-linecap', 'stroke-width', 'style', 'summary', 'target', 'title', 'type', 'viewbox', 'width', 'x', 'x1', 'x2', 'y', 'y1', 'y2',
]);

const BLOCKED_TAGS = new Set(['base', 'embed', 'form', 'iframe', 'link', 'meta', 'object', 'script', 'style', 'template']);

function isSafeUrl(value: string, attribute: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('javascript:') || normalized.startsWith('vbscript:') || normalized.startsWith('data:text/html')) return false;
  if (attribute === 'src') return normalized.startsWith('https://') || normalized.startsWith('http://') || normalized.startsWith('data:image/') || normalized.startsWith('file:') || normalized.startsWith('blob:');
  if (attribute === 'href') return normalized.startsWith('#') || normalized.startsWith('https://') || normalized.startsWith('http://') || normalized.startsWith('mailto:') || normalized.startsWith('tel:') || normalized.startsWith('file:');
  return true;
}

function isSafeStyle(value: string): boolean {
  const normalized = value.toLowerCase();
  return !normalized.includes('url(') && !normalized.includes('expression(') && !normalized.includes('@import') && !normalized.includes('javascript:');
}

function sanitizeElement(element: Element): void {
  for (const child of Array.from(element.children)) {
    const tagName = child.tagName.toLowerCase();
    if (BLOCKED_TAGS.has(tagName)) {
      child.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(tagName)) {
      const text = document.createTextNode(child.textContent || '');
      child.replaceWith(text);
      continue;
    }
    for (const attribute of Array.from(child.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (!ALLOWED_ATTRIBUTES.has(name) || (name === 'style' && !isSafeStyle(value)) || ((name === 'href' || name === 'src') && !isSafeUrl(value, name))) {
        child.removeAttribute(attribute.name);
      }
    }
    if (tagName === 'a' && child.getAttribute('target') === '_blank') child.setAttribute('rel', 'noopener noreferrer');
    sanitizeElement(child);
  }
}

/** Sanitize all HTML before it reaches a dangerouslySetInnerHTML boundary. */
export function sanitizeHtml(html: string): string {
  if (typeof document === 'undefined') {
    return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/javascript:/gi, '');
  }
  const purified = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTRIBUTES],
    FORBID_TAGS: [...BLOCKED_TAGS],
    ALLOW_DATA_ATTR: false,
  });
  const parsed = new DOMParser().parseFromString(`<div>${purified}</div>`, 'text/html');
  const root = parsed.body.firstElementChild;
  if (!root) return '';
  sanitizeElement(root);
  return root.innerHTML;
}
