export const workflowCardKey = card => String(card.cardKey || card.nmID || card.sku || card.id || '');
export const normalizeCardIdentifier = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('ru');

export function workflowCardIdentifiers(card) {
  const fields = ['cardKey', 'nmID', 'nmId', 'sku', 'id', 'vendorCode', 'supplierArticle', 'offerId', 'offer_id', 'productId', 'product_id'];
  return new Set([card, card.rawFields || {}].flatMap(source => fields.map(field => normalizeCardIdentifier(source[field]))).filter(Boolean));
}

export function matchWorkflowCards(cards, text) {
  const tokens = [...new Map(String(text).split(/[\n\r\t,;]+/).map(value => value.trim()).filter(Boolean).map(value => [normalizeCardIdentifier(value), value])).values()];
  const index = new Map();
  for (const card of cards) {
    const key = workflowCardKey(card);
    if (!key) continue;
    for (const alias of workflowCardIdentifiers(card)) {
      if (!index.has(alias)) index.set(alias, new Set());
      index.get(alias).add(key);
    }
  }
  const matched = new Set(), missing = [], ambiguous = [];
  for (const token of tokens) {
    const keys = index.get(normalizeCardIdentifier(token));
    if (!keys?.size) missing.push(token);
    else if (keys.size > 1) ambiguous.push(token);
    else matched.add([...keys][0]);
  }
  return {tokens, cardKeys: [...matched], missing, ambiguous};
}
