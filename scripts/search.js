(function (SFT) {
'use strict';
const { sortTransactions } = SFT.finance;
/**
 * search.js — live regex search: safe compilation, matching and highlighting.
 *
 * Safety rules
 * - Patterns are compiled inside try/catch; a bad pattern returns an error
 *   message and never throws.
 * - Highlighting is built with text nodes and <mark> elements (never innerHTML),
 *   so transaction text and user patterns cannot inject markup.
 * - Zero-length matches are skipped and lastIndex is advanced, so patterns such
 *   as `^`, `\b` or `(?=a)` cannot cause an infinite loop.
 * - Patterns are limited in length to reduce the risk of catastrophic
 *   backtracking from very long hand-written expressions.
 * - No eval() or new Function() anywhere.
 */

const MAX_PATTERN_LENGTH = 200;
const MAX_HIGHLIGHTS_PER_TEXT = 200;
/** Patterns with more open-ended repeats (*, +, {n,}) than this are refused (polynomial blow-up). */
const MAX_OPEN_REPEATS = 3;

/** Read a quantifier starting at s[i]; returns {end, max} or null. */
function readQuantifier(s, i) {
  let max;
  let end;
  if (s[i] === '*') { max = Infinity; end = i + 1; }
  else if (s[i] === '+') { max = Infinity; end = i + 1; }
  else if (s[i] === '?') { max = 1; end = i + 1; }
  else if (s[i] === '{') {
    const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(s.slice(i));
    if (!m) return null; // a literal "{"
    max = m[2] ? (m[3] === '' ? Infinity : Number(m[3])) : Number(m[1]);
    end = i + m[0].length;
  } else return null;
  if (s[end] === '?') end += 1; // lazy marker
  return { end, max };
}

/**
 * Static check for patterns that can freeze the page (catastrophic backtracking).
 * JavaScript cannot interrupt a running regex, so risky shapes are refused up front:
 *  - a group that is repeated (+, *, {n,m} with m>1) and itself contains a repeat or an
 *    alternation, e.g. (a+)+  (a|aa)*  (\w+\s?)*  (a?){30}
 *  - more than MAX_OPEN_REPEATS open-ended repeats in total, e.g. a+a+a+a+b
 * This is deliberately conservative; the message tells the user how to simplify.
 * @returns {string|null} a reason, or null when the pattern looks safe
 */
function analyzePattern(source) {
  const s = String(source);
  const groups = [];
  let openRepeats = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    let closed = null;
    if (c === '\\') {
      i += 2;
    } else if (c === '[') {
      i += 1;
      while (i < s.length && s[i] !== ']') i += s[i] === '\\' ? 2 : 1;
      i += 1;
    } else if (c === '(') {
      groups.push({ repeat: false, alt: false });
      i += 1;
      if (s[i] === '?') {
        i += 1;
        if (':=!'.includes(s[i])) i += 1;
        else if (s[i] === '<') {
          i += 1;
          if (s[i] === '=' || s[i] === '!') i += 1;
          else { while (i < s.length && s[i] !== '>') i += 1; i += 1; }
        }
      }
      continue;
    } else if (c === ')') {
      closed = groups.pop() ?? { repeat: false, alt: false };
      i += 1;
    } else if (c === '|') {
      if (groups.length) groups[groups.length - 1].alt = true;
      i += 1;
      continue;
    } else {
      i += 1;
    }
    const q = readQuantifier(s, i);
    const parent = groups[groups.length - 1];
    if (q) {
      i = q.end;
      if (q.max === Infinity) openRepeats += 1;
      if (closed && q.max > 1 && (closed.repeat || closed.alt)) {
        return 'A repeated group that contains repetition or alternatives (like (a+)+ or (a|b)*) can freeze the page. Remove the repeat after the group.';
      }
      if (parent) parent.repeat = true;
    }
    if (closed && parent) { // nested content counts for the enclosing group too
      parent.repeat = parent.repeat || closed.repeat;
      parent.alt = parent.alt || closed.alt;
    }
  }
  if (openRepeats > MAX_OPEN_REPEATS) {
    return `Too many open-ended repeats (*, +, {n,}); use at most ${MAX_OPEN_REPEATS} to keep search fast.`;
  }
  return null;
}

/**
 * @returns {{regex: RegExp|null, error: string|null, empty: boolean}}
 */
function compileSearch(pattern, ignoreCase = true) {
  const source = String(pattern ?? '');
  if (source === '') return { regex: null, error: null, empty: true };
  if (source.length > MAX_PATTERN_LENGTH) {
    return { regex: null, error: `Pattern is too long (maximum ${MAX_PATTERN_LENGTH} characters).`, empty: false };
  }
  const flags = ignoreCase ? 'gi' : 'g';
  let regex = null;
  let failure = null;
  // Unicode mode first so "." and classes treat an emoji as ONE character (highlights never split
  // a surrogate pair); fall back to classic mode for patterns that are only valid there (e.g. "\-").
  for (const f of [`${flags}u`, flags]) {
    try {
      regex = new RegExp(source, f);
      break;
    } catch (err) {
      failure = err;
    }
  }
  if (!regex) {
    const reason = String(failure.message)
      .replace(/^Invalid regular expression:\s*/i, '')
      .replace(/^\/.*\/[a-z]*:\s*/s, ''); // drop the echoed "/pattern/flags:" prefix
    return { regex: null, error: `Invalid pattern: ${reason}`, empty: false };
  }
  const unsafe = analyzePattern(source);
  if (unsafe) return { regex: null, error: `Pattern refused: ${unsafe}`, empty: false };
  return { regex, error: null, empty: false };
}

/** Does `text` contain at least one match? Safe to call repeatedly with a /g regex. */
function hasMatch(text, regex) {
  if (!regex) return true;
  regex.lastIndex = 0;
  const found = regex.test(text);
  regex.lastIndex = 0;
  return found;
}

/** Non-empty match ranges [start, end) in order. Never loops forever. */
function findRanges(text, regex, limit = MAX_HIGHLIGHTS_PER_TEXT) {
  const ranges = [];
  if (!regex) return ranges;
  regex.lastIndex = 0;
  let match;
  while (ranges.length < limit && (match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      // Zero-width match: step forward instead of looping. In unicode mode a step that lands in
      // the middle of an emoji would be rewound to its start and match again forever, so step
      // over the whole surrogate pair.
      const at = regex.lastIndex;
      const pair = regex.unicode && /[\ud800-\udbff]/.test(text[at] ?? '') && /[\udc00-\udfff]/.test(text[at + 1] ?? '');
      regex.lastIndex = at + (pair ? 2 : 1);
      if (regex.lastIndex > text.length) break;
      continue;
    }
    ranges.push([match.index, match.index + match[0].length]);
  }
  regex.lastIndex = 0;
  return ranges;
}

/** Split text into [{text, match}] segments so that joining them restores the text. */
function splitByRanges(text, ranges) {
  const segments = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

/**
 * Replace `container`'s content with `text`, wrapping matches in <mark>.
 * Only DOM methods that treat input as text are used.
 * @returns {number} number of highlighted ranges
 */
function renderHighlighted(container, text, regex) {
  container.textContent = '';
  const ranges = findRanges(text, regex);
  if (ranges.length === 0) {
    container.append(document.createTextNode(text));
    return 0;
  }
  for (const segment of splitByRanges(text, ranges)) {
    if (segment.match) {
      const mark = document.createElement('mark');
      mark.textContent = segment.text;
      container.append(mark);
    } else {
      container.append(document.createTextNode(segment.text));
    }
  }
  return ranges.length;
}

/** A transaction matches when its description OR category matches. */
function matchesTransaction(transaction, regex) {
  if (!regex) return true;
  return hasMatch(transaction.description, regex) || hasMatch(transaction.category, regex);
}

/**
 * Apply category filter, regex search and sorting, in that order.
 * @returns {{items: object[], error: string|null, regex: RegExp|null}}
 */
function selectTransactions(transactions, filters, displayCurrency, rates) {
  const { query = '', ignoreCase = true, category = 'all', sort = 'date-desc' } = filters;
  const compiled = compileSearch(query, ignoreCase);
  let items = transactions;
  if (category !== 'all') items = items.filter((t) => t.category === category);
  // An invalid pattern must not hide everything: show the filtered list and the error.
  if (compiled.regex) items = items.filter((t) => matchesTransaction(t, compiled.regex));
  items = sortTransactions(items, sort, displayCurrency, rates);
  return { items, error: compiled.error, regex: compiled.regex };
}

SFT.search = { MAX_PATTERN_LENGTH, MAX_HIGHLIGHTS_PER_TEXT, MAX_OPEN_REPEATS, analyzePattern, compileSearch, hasMatch, findRanges, splitByRanges, renderHighlighted, matchesTransaction, selectTransactions };
})(window.SFT = window.SFT || {});
