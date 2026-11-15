/* eslint-disable @typescript-eslint/no-explicit-any */
// Diff two pandoc JSON ASTs directly (the default, --algorithm=ast).
//
// The search space is restricted to what the output can express: a block is
// either unchanged, deleted, inserted, or paired with a similar block of the
// same kind, in which case the diff recurses (inline words for text, items for
// lists, rows for tables, lines for code). Structure is never merged across
// kinds, so the result is always a well-formed document.

import {diffArrays, diffLines} from 'diff';

interface Node {
  t: string;
  c?: any;
}
type Inline = Node;
type Block = Node;
type Status = 'eq' | 'del' | 'ins';

export interface PandocDocument {
  'pandoc-api-version': number[];
  meta: Record<string, unknown>;
  blocks: Block[];
}

// Minimum similarity (Dice coefficient over words) for two blocks to be
// treated as "the same block, edited" rather than a deletion and an insertion.
const PAIR_THRESHOLD = 0.5;
// When exactly one old block and one new block sit between the same unchanged
// neighbours, their position is evidence too, so less similarity is needed --
// and none at all for a heading, which is usually only a few words long.
const LONE_PAIR_THRESHOLD = 0.25;
// Largest problem (old blocks x new blocks) the pairing step will consider.
const MAX_GAP_CELLS = 1e6;
// Below this size, sequences are aligned purely by similarity, which finds
// the smallest set of edits. Above it, identical blocks are matched first
// (fast) and only the runs in between are aligned by similarity.
const MAX_FULL_CELLS = 250000;

const SIMPLE_WRAPPERS = new Set([
  'Emph',
  'Strong',
  'Underline',
  'Strikeout',
  'Superscript',
  'Subscript',
  'SmallCaps',
]);

const NO_ATTR = ['', [], []];

function plainText(xs: Inline[]): string {
  return xs
    .map(x => {
      if (x.t === 'Str') return x.c;
      if (x.t === 'Space' || x.t === 'SoftBreak') return ' ';
      if (Array.isArray(x.c)) {
        const inner = x.c.find((c: unknown) => Array.isArray(c) && c[0]?.t);
        return inner ? plainText(inner) : '';
      }
      return '';
    })
    .join('');
}

const span = (cls: string, c: Inline[]): Inline => ({
  t: 'Span',
  c: [['', [cls], []], c],
});

// ---------------------------------------------------------------------------
// Generic traversal

type InlineFn = (xs: Inline[]) => Inline[];
type BlockFn = (bs: Block[]) => Block[];

// Apply fi/fb to the inline/block lists directly inside a block.
function mapBlock(b: Block, fi: InlineFn, fb: BlockFn): Block {
  const caption = ([short, blocks]: [Inline[] | null, Block[]]) => [
    short,
    fb(blocks),
  ];
  switch (b.t) {
    case 'Plain':
    case 'Para':
      return {t: b.t, c: fi(b.c)};
    case 'LineBlock':
      return {t: b.t, c: b.c.map(fi)};
    case 'Header':
      return {t: b.t, c: [b.c[0], b.c[1], fi(b.c[2])]};
    case 'BlockQuote':
      return {t: b.t, c: fb(b.c)};
    case 'BulletList':
      return {t: b.t, c: b.c.map(fb)};
    case 'OrderedList':
      return {t: b.t, c: [b.c[0], b.c[1].map(fb)]};
    case 'DefinitionList':
      return {
        t: b.t,
        c: b.c.map(([term, defs]: [Inline[], Block[][]]) => [
          fi(term),
          defs.map(fb),
        ]),
      };
    case 'Div':
      return {t: b.t, c: [b.c[0], fb(b.c[1])]};
    case 'Figure':
      return {t: b.t, c: [b.c[0], caption(b.c[1]), fb(b.c[2])]};
    case 'Table': {
      const [attr, cap, specs, head, bodies, foot] = b.c;
      const rows = (rs: any[]) =>
        rs.map(([a, cells]) => [
          a,
          cells.map((cell: any[]) => [...cell.slice(0, 4), fb(cell[4])]),
        ]);
      return {
        t: b.t,
        c: [
          attr,
          caption(cap),
          specs,
          [head[0], rows(head[1])],
          bodies.map(([a, rhc, h, bd]: any[]) => [a, rhc, rows(h), rows(bd)]),
          [foot[0], rows(foot[1])],
        ],
      };
    }
    default:
      return b;
  }
}

// Drop wrappers that carry no visible content of their own (spans, divs,
// citations, figures) so both documents are compared in the same plain shape.
function normInlines(xs: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const x of xs) {
    switch (x.t) {
      case 'Span':
      case 'Cite':
        out.push(...normInlines(x.c[1]));
        break;
      case 'SoftBreak':
        out.push({t: 'Space'});
        break;
      case 'Quoted':
        out.push({t: x.t, c: [x.c[0], normInlines(x.c[1])]});
        break;
      case 'Link':
        out.push({t: x.t, c: [x.c[0], normInlines(x.c[1]), x.c[2]]});
        break;
      case 'Image': {
        // attributes (sizes etc.) can't be written without raw HTML, and a
        // title that repeats the description is redundant
        const alt = normInlines(x.c[1]);
        const [src, title] = x.c[2];
        const redundant = title === plainText(alt) || title === 'fig:';
        out.push({t: x.t, c: [NO_ATTR, alt, [src, redundant ? '' : title]]});
        break;
      }
      case 'Note':
        out.push({t: x.t, c: normBlocks(x.c)});
        break;
      default:
        if (SIMPLE_WRAPPERS.has(x.t)) {
          out.push({t: x.t, c: normInlines(x.c)});
        } else {
          out.push(x);
        }
    }
  }
  return out;
}

function normBlocks(bs: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of bs) {
    if (b.t === 'Div') {
      out.push(...normBlocks(b.c[1]));
    } else if (b.t === 'Figure') {
      // back to the paragraph-with-an-image that Markdown writes it as,
      // with the caption as the image's description if it has none
      const caption = normBlocks(b.c[1][1]);
      for (const inner of normBlocks(b.c[2])) {
        if (inner.t !== 'Plain') {
          out.push(inner);
          continue;
        }
        const [img] = inner.c;
        if (
          inner.c.length === 1 &&
          img.t === 'Image' &&
          !img.c[1].length &&
          caption.length === 1 &&
          isText(caption[0])
        ) {
          img.c[1] = caption[0].c;
        }
        out.push({t: 'Para', c: inner.c});
      }
    } else if (b.t === 'BulletList' || b.t === 'OrderedList') {
      // compact lists: an item that is a single paragraph is written tight
      const tight = (item: Block[]) =>
        item.length === 1 && item[0].t === 'Para'
          ? [{t: 'Plain', c: item[0].c}]
          : item;
      out.push(mapBlock(b, normInlines, bs => tight(normBlocks(bs))));
    } else {
      out.push(mapBlock(b, normInlines, normBlocks));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Whole-block insertions and deletions

function codeDiff(text1: string, text2: string): Block {
  const lines: string[] = [];
  for (const part of diffLines(text1, text2)) {
    const prefix = part.removed ? '-' : part.added ? '+' : ' ';
    let chunk = part.value;
    if (chunk.endsWith('\n')) chunk = chunk.slice(0, -1);
    for (const line of chunk.split('\n')) lines.push(prefix + line);
  }
  return {t: 'CodeBlock', c: [['', ['diff'], []], lines.join('\n')]};
}

function markBlock(b: Block, status: 'del' | 'ins'): Block[] {
  switch (b.t) {
    case 'CodeBlock':
    case 'RawBlock':
      return [status === 'del' ? codeDiff(b.c[1], '') : codeDiff('', b.c[1])];
    case 'HorizontalRule':
      // TODO: there is no way to mark a rule as deleted
      return status === 'del' ? [] : [b];
    default:
      return [
        mapBlock(
          b,
          xs => (xs.length ? [span(status, xs)] : xs),
          bs => markBlocks(bs, status)
        ),
      ];
  }
}

function markBlocks(bs: Block[], status: 'del' | 'ins'): Block[] {
  return bs.flatMap(b => markBlock(b, status));
}

// ---------------------------------------------------------------------------
// Alignment of sequences (blocks, list items, table rows)

interface Unit<T> {
  key: string;
  kind: string;
  bag: Map<string, number>;
  size: number;
  value: T;
}

const TEXT_LEAVES = new Set([
  'Code',
  'CodeBlock',
  'Math',
  'RawInline',
  'RawBlock',
]);

function collectWords(v: any, out: string[]) {
  if (Array.isArray(v)) {
    for (const x of v) collectWords(x, out);
  } else if (v && typeof v === 'object' && typeof v.t === 'string') {
    if (v.t === 'Str') {
      out.push(...(v.c.match(/[\p{L}\p{N}]+/gu) || []));
    } else if (TEXT_LEAVES.has(v.t)) {
      out.push(...v.c[1].split(/\s+/).filter(Boolean));
    } else if (v.t === 'Image') {
      out.push('\u0000img:' + v.c[2][0]);
    } else if ('c' in v) {
      collectWords(v.c, out);
    }
  }
}

function unit<T>(value: T, kind: string): Unit<T> {
  const words: string[] = [];
  collectWords(value, words);
  const bag = new Map<string, number>();
  for (const w of words) bag.set(w, (bag.get(w) || 0) + 1);
  return {key: JSON.stringify(value), kind, bag, size: words.length, value};
}

function similarity<T>(a: Unit<T>, b: Unit<T>): number {
  if (a.kind !== b.kind) return 0;
  if (a.key === b.key) return 1;
  if (!a.size || !b.size) return 0;
  const [small, large] = a.bag.size < b.bag.size ? [a, b] : [b, a];
  let common = 0;
  for (const [w, n] of small.bag) {
    common += Math.min(n, large.bag.get(w) || 0);
  }
  return (2 * common) / (a.size + b.size);
}

// [old, new, identical]; old or new is null for an insertion or deletion
type Pair<T> = [T | null, T | null, boolean];

// Pair up similar units, keeping order, so as to maximise total similarity.
function alignGap<T>(a: Unit<T>[], b: Unit<T>[]): Pair<T>[] {
  const n = a.length;
  const m = b.length;
  const unpaired = (): Pair<T>[] => [
    ...a.map((u): Pair<T> => [u.value, null, false]),
    ...b.map((u): Pair<T> => [null, u.value, false]),
  ];
  if (!n || !m || n * m > MAX_GAP_CELLS) return unpaired();
  let threshold = PAIR_THRESHOLD;
  if (n === 1 && m === 1 && a[0].kind === b[0].kind) {
    threshold = a[0].kind === 'Header' ? 0 : LONE_PAIR_THRESHOLD;
  }

  const sims: number[][] = [];
  const score: number[][] = [new Array(m + 1).fill(0)];
  for (let i = 1; i <= n; i++) {
    sims.push([]);
    score.push(new Array(m + 1).fill(0));
    for (let j = 1; j <= m; j++) {
      const s = similarity(a[i - 1], b[j - 1]);
      sims[i - 1].push(s);
      let best = Math.max(score[i - 1][j], score[i][j - 1]);
      if (s >= threshold) best = Math.max(best, score[i - 1][j - 1] + s);
      score[i][j] = best;
    }
  }

  const out: Pair<T>[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      sims[i - 1][j - 1] >= threshold &&
      score[i][j] === score[i - 1][j - 1] + sims[i - 1][j - 1]
    ) {
      i--;
      j--;
      out.push([a[i].value, b[j].value, a[i].key === b[j].key]);
    } else if (j > 0 && (i === 0 || score[i][j] === score[i][j - 1])) {
      out.push([null, b[--j].value, false]);
    } else {
      out.push([a[--i].value, null, false]);
    }
  }
  return out.reverse();
}

function align<T>(a: Unit<T>[], b: Unit<T>[]): Pair<T>[] {
  // common prefix and suffix
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre].key === b[pre].key) pre++;
  let post = 0;
  while (
    post < a.length - pre &&
    post < b.length - pre &&
    a[a.length - 1 - post].key === b[b.length - 1 - post].key
  ) {
    post++;
  }
  const same = (x: Unit<T>, k: number, bs: Unit<T>[]): Pair<T> => [
    x.value,
    bs[k].value,
    true,
  ];
  const midA = a.slice(pre, a.length - post);
  const midB = b.slice(pre, b.length - post);
  return [
    ...a.slice(0, pre).map((x, k) => same(x, k, b)),
    ...(midA.length * midB.length <= MAX_FULL_CELLS
      ? alignGap(midA, midB)
      : alignAnchored(midA, midB)),
    ...a.slice(a.length - post).map((x, k) => same(x, k, b.slice(-post))),
  ];
}

function alignAnchored<T>(a: Unit<T>[], b: Unit<T>[]): Pair<T>[] {
  const out: Pair<T>[] = [];
  let i = 0;
  let j = 0;
  let gapA: Unit<T>[] = [];
  let gapB: Unit<T>[] = [];
  const flush = () => {
    out.push(...alignGap(gapA, gapB));
    gapA = [];
    gapB = [];
  };
  const parts = diffArrays(
    a.map(u => u.key),
    b.map(u => u.key)
  );
  for (const part of parts) {
    const n = part.value.length;
    if (part.removed) {
      gapA.push(...a.slice(i, i + n));
      i += n;
    } else if (part.added) {
      gapB.push(...b.slice(j, j + n));
      j += n;
    } else {
      flush();
      for (let k = 0; k < n; k++)
        out.push([a[i + k].value, b[j + k].value, true]);
      i += n;
      j += n;
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Inline diff

interface Wrap {
  sig: string;
  id: number;
  make: (c: Inline[]) => Inline;
}
interface Tok {
  key: string;
  node: Inline;
  wraps: Wrap[];
  word: boolean; // carries content (as opposed to spacing/punctuation)
}
interface Item {
  status: Status;
  tok: Tok;
  other?: Tok; // the new document's token, for unchanged items
}

let nextWrapId = 0;

function wrapperOf(x: Inline): [Wrap, Inline[]] | null {
  const id = nextWrapId++;
  if (SIMPLE_WRAPPERS.has(x.t)) {
    return [{sig: x.t, id, make: c => ({t: x.t, c})}, x.c];
  }
  if (x.t === 'Quoted') {
    return [
      {sig: 'Quoted:' + x.c[0].t, id, make: c => ({t: x.t, c: [x.c[0], c]})},
      x.c[1],
    ];
  }
  if (x.t === 'Link') {
    return [
      {
        sig: 'Link:' + JSON.stringify(x.c[2]),
        id,
        make: c => ({t: x.t, c: [x.c[0], c, x.c[2]]}),
      },
      x.c[1],
    ];
  }
  return null;
}

function flatten(xs: Inline[], wraps: Wrap[], out: Tok[]) {
  const prefix = wraps.map(w => w.sig).join('>') + '\u0000';
  for (const x of xs) {
    const wrapper = wrapperOf(x);
    if (wrapper) {
      flatten(wrapper[1], [...wraps, wrapper[0]], out);
      continue;
    }
    let key: string;
    let word = true;
    if (x.t === 'Str') {
      key = 'Str:' + x.c;
      word = /[\p{L}\p{N}]/u.test(x.c);
    } else if (x.t === 'Space' || x.t === 'LineBreak') {
      key = x.t;
      word = false;
    } else if (x.t === 'Note') {
      key = 'Note'; // footnotes line up in order; their content is diffed
    } else {
      key = JSON.stringify(x);
    }
    out.push({key: prefix + key, node: x, wraps, word});
  }
}

function mergeStrs(xs: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const x of xs) {
    const last = out[out.length - 1];
    if (x.t === 'Str' && last && last.t === 'Str') {
      out[out.length - 1] = {t: 'Str', c: last.c + x.c};
    } else {
      out.push(x);
    }
  }
  return out;
}

interface Built {
  node: Inline;
  status: Status;
}

// Wrap runs of deleted/inserted nodes; a deletion directly followed by an
// insertion is a substitution.
function markRuns(nodes: Built[]): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  const run = (status: Status) => {
    const start = i;
    while (i < nodes.length && nodes[i].status === status) i++;
    return mergeStrs(nodes.slice(start, i).map(n => n.node));
  };
  while (i < nodes.length) {
    if (nodes[i].status === 'eq') {
      out.push(...run('eq'));
    } else if (nodes[i].status === 'del') {
      const del = span('del', run('del'));
      if (i < nodes.length && nodes[i].status === 'ins') {
        out.push(span('sub', [del, span('ins', run('ins'))]));
      } else {
        out.push(del);
      }
    } else {
      out.push(span('ins', run('ins')));
    }
  }
  return mergeStrs(out);
}

// Rebuild the inline tree from a flat list of tokens. A wrapper (emphasis,
// link, ...) whose content all has one status is marked from the outside.
function build(items: Item[], depth: number): Built[] {
  const out: Built[] = [];
  let i = 0;
  while (i < items.length) {
    const wrap = items[i].tok.wraps[depth];
    if (!wrap) {
      out.push({node: items[i].tok.node, status: items[i].status});
      i++;
      continue;
    }
    const start = i;
    while (i < items.length && items[i].tok.wraps[depth]?.id === wrap.id) i++;
    const children = build(items.slice(start, i), depth + 1);
    const status = children[0].status;
    if (children.every(c => c.status === status)) {
      out.push({node: wrap.make(mergeStrs(children.map(c => c.node))), status});
    } else {
      out.push({node: wrap.make(markRuns(children)), status: 'eq'});
    }
  }
  return out;
}

const wrapSigs = (it: Item) => it.tok.wraps.map(w => w.sig).join('>');
const wrapIds = (it: Item) => it.tok.wraps.map(w => w.id).join('>');

// Call f(start, end) for each maximal run of items that are all unchanged
// (changed = false) or all changed (changed = true); f returns the items to
// put in the run's place.
function mapRuns(
  items: Item[],
  changed: boolean,
  f: (start: number, end: number) => Item[]
): Item[] {
  const out: Item[] = [];
  let s = 0;
  while (s < items.length) {
    if ((items[s].status !== 'eq') !== changed) {
      out.push(items[s++]);
      continue;
    }
    let e = s;
    while (e < items.length && (items[e].status !== 'eq') === changed) e++;
    out.push(...f(s, e));
    s = e;
  }
  return out;
}

// Unchanged spacing/punctuation stranded between two changes only chops the
// change into fragments, so make it part of the change -- unless that would
// drag the change across a formatting boundary.
function foldWeakMatches(items: Item[]): Item[] {
  return mapRuns(items, false, (s, e) => {
    const run = items.slice(s, e);
    const weak =
      s > 0 &&
      e < items.length &&
      run.every(it => !it.tok.word) &&
      items.slice(s - 1, e + 1).every(it => wrapSigs(it) === wrapSigs(run[0]));
    if (!weak) return run;
    return [
      ...run.map((it): Item => ({status: 'del', tok: it.tok})),
      ...run.map((it): Item => ({status: 'ins', tok: it.other!})),
    ];
  });
}

// Wrappers (emphasis, links, ...) around unchanged tokens exist in both
// documents. Give the new document's wrapper the old one's identity, so that
// insertions land inside the same wrapper as their unchanged neighbours.
function shareWrappers(items: Item[]): Item[] {
  const canon = new Map<number, number>();
  for (const it of items) {
    if (it.status !== 'eq') continue;
    it.other!.wraps.forEach((w, k) => {
      if (!canon.has(w.id)) canon.set(w.id, it.tok.wraps[k].id);
    });
  }
  return items.map(it => {
    if (it.status !== 'ins') return it;
    const wraps = it.tok.wraps.map(w => ({...w, id: canon.get(w.id) ?? w.id}));
    return {...it, tok: {...it.tok, wraps}};
  });
}

// Split items into runs that sit inside the same wrappers.
function wrapperRuns(items: Item[]): Item[][] {
  const out: Item[][] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && wrapIds(last[0]) === wrapIds(it)) last.push(it);
    else out.push([it]);
  }
  return out;
}

// Move matching elements off the front and back of two lists, always leaving
// at least one element in each. Returns the [old, new] pairs removed.
function peelEnds<T>(a: T[], b: T[], match: (x: T, y: T) => boolean) {
  const front: [T, T][] = [];
  const back: [T, T][] = [];
  while (a.length > 1 && b.length > 1 && match(a[0], b[0])) {
    front.push([a.shift()!, b.shift()!]);
  }
  while (
    a.length > 1 &&
    b.length > 1 &&
    match(a[a.length - 1], b[b.length - 1])
  ) {
    back.unshift([a.pop()!, b.pop()!]);
  }
  return {front, back};
}

// Arrange each changed region as deletions followed by insertions, so that it
// reads as one substitution rather than interleaved fragments.
function orderChanges(items: Item[]): Item[] {
  return mapRuns(items, true, (s, e) => {
    const region = items.slice(s, e);
    const dels = region.filter(it => it.status === 'del');
    const inss = region.filter(it => it.status === 'ins');

    // spacing at both ends of a substitution belongs outside it
    const spacing = peelEnds(
      dels,
      inss,
      (d, n) => !d.tok.word && d.tok.key === n.tok.key
    );
    const unchanged = (pairs: [Item, Item][]) =>
      pairs.map(([d, n]): Item => ({status: 'eq', tok: d.tok, other: n.tok}));

    // a change inside a wrapper that both documents have stays inside it,
    // rather than splitting the wrapper in two
    const delRuns = wrapperRuns(dels);
    const insRuns = wrapperRuns(inss);
    const inside = peelEnds(
      delRuns,
      insRuns,
      (d, n) => wrapIds(d[0]) === wrapIds(n[0])
    );
    const flat = (pairs: [Item[], Item[]][]) => pairs.flat(2);

    return [
      ...unchanged(spacing.front),
      ...flat(inside.front),
      ...delRuns.flat(),
      ...insRuns.flat(),
      ...flat(inside.back),
      ...unchanged(spacing.back),
    ];
  });
}

// Diff two inline lists. Returns null if they have nothing in common (unless
// `force` is set), in which case the caller should treat the blocks as
// unrelated.
function diffInlines(a: Inline[], b: Inline[], force = false): Inline[] | null {
  const ta: Tok[] = [];
  const tb: Tok[] = [];
  flatten(a, [], ta);
  flatten(b, [], tb);

  let items: Item[] = [];
  let i = 0;
  let j = 0;
  const parts = diffArrays(
    ta.map(t => t.key),
    tb.map(t => t.key)
  );
  for (const part of parts) {
    for (let k = 0; k < part.value.length; k++) {
      if (part.removed) items.push({status: 'del', tok: ta[i++]});
      else if (part.added) items.push({status: 'ins', tok: tb[j++]});
      else items.push({status: 'eq', tok: ta[i++], other: tb[j++]});
    }
  }

  items = orderChanges(shareWrappers(foldWeakMatches(items)));

  if (!force && !items.some(it => it.status === 'eq' && it.tok.word)) {
    return null;
  }

  // footnotes are matched up in order; diff their contents
  items = items.map(it => {
    if (it.status !== 'eq' || it.tok.node.t !== 'Note') return it;
    const node = {t: 'Note', c: diffBlocks(it.tok.node.c, it.other!.node.c)};
    return {...it, tok: {...it.tok, node}};
  });

  return markRuns(build(items, 0));
}

// ---------------------------------------------------------------------------
// Block diff

function blockKind(b: Block): string {
  if (b.t === 'Para' || b.t === 'Plain') return 'text';
  if (b.t === 'BulletList' || b.t === 'OrderedList') return 'list';
  return b.t;
}

const isText = (b: Block) => blockKind(b) === 'text';

function replaced(a: Block, b: Block): Block[] {
  return [...markBlock(a, 'del'), ...markBlock(b, 'ins')];
}

// Diff sequences of block lists (list items, definitions).
function diffItems(a: Block[][], b: Block[][]): Block[][] {
  const pairs = align(
    a.map(x => unit(x, 'item')),
    b.map(x => unit(x, 'item'))
  );
  return pairs.map(([x, y, same]) => {
    if (same) return y!;
    if (!y) return markBlocks(x!, 'del');
    if (!x) return markBlocks(y, 'ins');
    return diffBlocks(x, y);
  });
}

type Row = [any, any[][]];

function diffCell(a: any[], b: any[]): any[] {
  const xa: Block[] = a[4];
  const xb: Block[] = b[4];
  // Keep simple cells as a single line of text, so that the table can still
  // be written as a pipe table.
  if (
    xa.length <= 1 &&
    xb.length <= 1 &&
    xa.every(isText) &&
    xb.every(isText)
  ) {
    const inlines = diffInlines(xa[0]?.c || [], xb[0]?.c || [], true)!;
    const t = (xb[0] || xa[0] || {t: 'Plain'}).t;
    return [...b.slice(0, 4), inlines.length ? [{t, c: inlines}] : []];
  }
  return [...b.slice(0, 4), diffBlocks(xa, xb)];
}

function markRow([attr, cells]: Row, status: 'del' | 'ins'): Row {
  return [
    attr,
    cells.map(cell => [...cell.slice(0, 4), markBlocks(cell[4], status)]),
  ];
}

function diffRows(a: Row[], b: Row[]): Row[] {
  const pairs = align(
    a.map(r => unit(r, 'row')),
    b.map(r => unit(r, 'row'))
  );
  const out: Row[] = [];
  for (const [x, y, same] of pairs) {
    if (same) {
      out.push(y!);
    } else if (!y) {
      out.push(markRow(x!, 'del'));
    } else if (!x) {
      out.push(markRow(y, 'ins'));
    } else if (x[1].length !== y[1].length) {
      out.push(markRow(x, 'del'), markRow(y, 'ins'));
    } else {
      out.push([y[0], y[1].map((cell, k) => diffCell(x[1][k], cell))]);
    }
  }
  return out;
}

function diffTable(a: Block, b: Block): Block | null {
  const [, capA, specsA, headA, bodiesA, footA] = a.c;
  const [attr, capB, specsB, headB, bodiesB, footB] = b.c;
  if (specsA.length !== specsB.length || bodiesA.length !== bodiesB.length) {
    return null; // TODO: column insertions and deletions
  }
  return {
    t: 'Table',
    c: [
      attr,
      [capB[0], diffBlocks(capA[1], capB[1])],
      specsB,
      [headB[0], diffRows(headA[1], headB[1])],
      bodiesB.map(([battr, rhc, head, body]: any[], k: number) => [
        battr,
        rhc,
        diffRows(bodiesA[k][2], head),
        diffRows(bodiesA[k][3], body),
      ]),
      [footB[0], diffRows(footA[1], footB[1])],
    ],
  };
}

// Diff two blocks of the same kind that were judged similar.
function diffPair(a: Block, b: Block): Block[] {
  switch (blockKind(a)) {
    case 'text': {
      const inlines = diffInlines(a.c, b.c);
      return inlines ? [{t: b.t, c: inlines}] : replaced(a, b);
    }
    case 'Header': {
      if (a.c[0] !== b.c[0]) return replaced(a, b);
      return [{t: b.t, c: [b.c[0], b.c[1], diffInlines(a.c[2], b.c[2], true)]}];
    }
    case 'CodeBlock':
      return [codeDiff(a.c[1], b.c[1])];
    case 'BlockQuote':
      return [{t: b.t, c: diffBlocks(a.c, b.c)}];
    case 'list': {
      const items = diffItems(
        a.t === 'OrderedList' ? a.c[1] : a.c,
        b.t === 'OrderedList' ? b.c[1] : b.c
      );
      return [{t: b.t, c: b.t === 'OrderedList' ? [b.c[0], items] : items}];
    }
    case 'DefinitionList': {
      type Def = [Inline[], Block[][]];
      const pairs = align<Def>(
        a.c.map((d: Def) => unit(d, 'def')),
        b.c.map((d: Def) => unit(d, 'def'))
      );
      const mark = ([term, defs]: Def, status: 'del' | 'ins'): Def => [
        term.length ? [span(status, term)] : term,
        defs.map(d => markBlocks(d, status)),
      ];
      const defs = pairs.map(([x, y, same]): Def => {
        if (same) return y!;
        if (!y) return mark(x!, 'del');
        if (!x) return mark(y, 'ins');
        return [diffInlines(x[0], y[0], true)!, diffItems(x[1], y[1])];
      });
      return [{t: b.t, c: defs}];
    }
    case 'LineBlock': {
      const pairs = align<Inline[]>(
        a.c.map((l: Inline[]) => unit(l, 'line')),
        b.c.map((l: Inline[]) => unit(l, 'line'))
      );
      const lines = pairs.map(([x, y, same]) => {
        if (same) return y!;
        if (!y) return x!.length ? [span('del', x!)] : x!;
        if (!x) return y.length ? [span('ins', y)] : y;
        return diffInlines(x, y, true)!;
      });
      return [{t: b.t, c: lines}];
    }
    case 'Table': {
      const table = diffTable(a, b);
      return table ? [table] : replaced(a, b);
    }
    default:
      return replaced(a, b);
  }
}

function diffBlocks(a: Block[], b: Block[]): Block[] {
  const pairs = align(
    a.map(x => unit(x, blockKind(x))),
    b.map(x => unit(x, blockKind(x)))
  );
  const out: Block[] = [];
  for (const [x, y, same] of pairs) {
    if (same) out.push(y!);
    else if (!y) out.push(...markBlock(x!, 'del'));
    else if (!x) out.push(...markBlock(y, 'ins'));
    else out.push(...diffPair(x, y));
  }
  return out;
}

// ---------------------------------------------------------------------------

// Fraction of the words in a diffed document that are unchanged.
export function unchangedFraction(doc: PandocDocument): number {
  let total = 0;
  let changed = 0;
  const walk = (v: any, inChange: boolean) => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x, inChange);
    } else if (v && typeof v === 'object' && typeof v.t === 'string') {
      if (v.t === 'Str') {
        total++;
        if (inChange) changed++;
      } else if (v.t === 'Span') {
        const cls = v.c[0][1][0];
        walk(v.c[1], inChange || cls === 'del' || cls === 'ins');
      } else if ('c' in v) {
        walk(v.c, inChange);
      }
    }
  };
  walk(doc.blocks, false);
  return total ? 1 - changed / total : 1;
}

export function diffDocuments(
  doc1: PandocDocument,
  doc2: PandocDocument
): PandocDocument {
  return {
    'pandoc-api-version': doc2['pandoc-api-version'],
    meta: {},
    blocks: diffBlocks(normBlocks(doc1.blocks), normBlocks(doc2.blocks)),
  };
}
