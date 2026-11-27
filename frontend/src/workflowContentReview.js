const tokenPattern = /\s+|[\p{L}\p{N}]+\+*|[^\s]/gu;

export function contentTextDiff(original, draft) {
  const before = original.match(tokenPattern) || [];
  const after = draft.match(tokenPattern) || [];
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let left = before.length;
  let right = after.length;
  while (left > start && right > start && before[left - 1] === after[right - 1]) {
    left--;
    right--;
  }
  const prefix = before.slice(0, start).join('');
  const suffix = before.slice(left).join('');
  const prev = before.slice(start, left);
  const next = after.slice(start, right);
  const result = {before: [{text: prefix}], after: [{text: prefix}], changed: original !== draft};
  const put = (side, text, changed) => {
    if (!text) return;
    const last = result[side].at(-1);
    if (Boolean(last?.changed) === changed) last.text += text;
    else result[side].push({text, changed});
  };
  if (prev.length * next.length > 500000 || !prev.length || !next.length) {
    put('before', prev.join(''), true);
    put('after', next.join(''), true);
  } else {
    const stride = next.length + 1;
    const matches = new Uint16Array((prev.length + 1) * stride);
    for (let i = prev.length - 1; i >= 0; i--) {
      for (let j = next.length - 1; j >= 0; j--) {
        matches[i * stride + j] = prev[i] === next[j]
          ? 1 + matches[(i + 1) * stride + j + 1]
          : Math.max(matches[(i + 1) * stride + j], matches[i * stride + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < prev.length || j < next.length) {
      if (i < prev.length && j < next.length && prev[i] === next[j]) {
        put('before', prev[i++], false);
        put('after', next[j++], false);
      } else if (i < prev.length && (j === next.length || matches[(i + 1) * stride + j] >= matches[i * stride + j + 1])) {
        put('before', prev[i++], true);
      } else {
        put('after', next[j++], true);
      }
    }
  }
  put('before', suffix, false);
  put('after', suffix, false);
  return result;
}

const titleMeasures = /(?<![\p{L}\p{N}])[+-]?\d+(?:[.,]\d+)?\s*(?:мл|мг|кг|гр\.?|г|л|мм|см|шт\.?|°\s*[сc])(?![\p{L}\p{N}])/giu;

export function titleMeasurementChanges(original, draft) {
  const measures = text => new Map((text.match(titleMeasures) || []).map(value => {
    const canonical = value.toLowerCase().replace(/\s/g, '').replace(',', '.').replace(/\.$/, '').replace(/гр$/, 'г');
    return [canonical, value.replace(/(\d)(?=[а-я°])/iu, '$1 ')];
  }));
  const before = measures(original);
  const after = measures(draft);
  return {
    removed: [...before].filter(([key]) => !after.has(key)).map(([, value]) => value),
    added: [...after].filter(([key]) => !before.has(key)).map(([, value]) => value),
  };
}
