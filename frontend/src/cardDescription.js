const blockTags = new Set(['ADDRESS', 'ARTICLE', 'BLOCKQUOTE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'OL', 'P', 'PRE', 'SECTION', 'UL']);
const hiddenTags = new Set(['IFRAME', 'NOSCRIPT', 'SCRIPT', 'STYLE', 'TEMPLATE']);

export function cardDescriptionText(value) {
  const source = String(value ?? '');
  if (!/[<&]/.test(source)) return source;

  const template = document.createElement('template');
  template.innerHTML = source;
  const parts = [];
  function append(node) {
    if (node.nodeType === 3) {
      parts.push(node.nodeValue);
      return;
    }
    const tag = node.tagName;
    if (hiddenTags.has(tag)) return;
    if (tag === 'LI') parts.push('\n• ');
    else if (blockTags.has(tag)) parts.push('\n');
    else if (tag === 'BR') parts.push('\n');
    for (const child of node.childNodes) append(child);
    if (blockTags.has(tag)) parts.push('\n');
  }
  append(template.content);
  return parts.join('').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}
