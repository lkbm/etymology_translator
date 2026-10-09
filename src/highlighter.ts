import { lookupEtymology } from './lookup';

/**
 * Takes rendered markdown HTML, walks text nodes, wraps each word
 * in <span class="etym-{origin}">word</span>.
 */
export function highlightEtymology(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  walkTextNodes(doc.body);
  return doc.body.innerHTML;
}

const SKIP_TAGS = new Set(['code', 'pre', 'script', 'style']);
const WORD_RE = /[\w'-]+|[^\w'-]+/g;
const IS_WORD = /[\w'-]/;

function walkTextNodes(root: Node): void {
  // Snapshot text nodes to avoid mutation issues during iteration
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  for (const textNode of textNodes) {
    const parent = textNode.parentNode;
    if (!parent) continue;

    // Skip code/pre/script/style elements
    if (parent instanceof HTMLElement && SKIP_TAGS.has(parent.tagName.toLowerCase())) {
      continue;
    }

    const text = textNode.textContent ?? '';
    const tokens = text.match(WORD_RE);
    if (!tokens) continue;

    const frag = document.createDocumentFragment();
    for (const token of tokens) {
      if (IS_WORD.test(token)) {
        const span = document.createElement('span');
        span.className = `etym-${lookupEtymology(token)}`;
        span.textContent = token;
        frag.appendChild(span);
      } else {
        frag.appendChild(document.createTextNode(token));
      }
    }
    parent.replaceChild(frag, textNode);
  }
}
