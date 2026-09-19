import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A lexical index over the Sales Manual.
 * Authority: outbound-sales-brain-sales-manual-rag-spec.md.
 *
 * The spec describes an index with both a lexical and an embedding half, and records
 * a version for each. This is the lexical half: BM25 over heading-delimited chunks,
 * with no model, no credential and no network. It is useful on its own -- a rep
 * asking "what do I say if they already use ServiceTitan" is asking a keyword
 * question -- and it is what the embedding half will be measured against when it
 * arrives, because a retriever that cannot beat BM25 is not earning its cost.
 *
 * Two rules from the spec are enforced here rather than left to the caller:
 *
 *   - commercial truth precedence: pricing, offers and what we sell come from
 *     launch-decisions.md, which outranks the manual for those questions;
 *   - no drifting duplicate doctrine: only the paths the spec names are indexed, so
 *     an old brainstorming document cannot answer a question about price.
 */

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');

/** Everything the index is allowed to read, in precedence order. */
export const CORPUS_PATHS = [
  { path: 'docs/00-company/launch-decisions.md', authority: 'commercial_truth' as const },
  { path: 'docs/07-sales/training-manual', authority: 'doctrine' as const },
];

/**
 * Paths that must never be indexed however useful they look: older planning and
 * brainstorming documents whose prices and offers were superseded.
 */
export const EXCLUDED_PATTERNS = [
  /\/brainstorm/i, /\/drafts?\//i, /\/archive/i, /\/old-/i, /-deprecated/i,
  /\/node_modules\//, /\.(png|jpg|jpeg|pdf|zip|csv|yaml|yml|json)$/i,
];

export type ChunkAuthority = 'commercial_truth' | 'doctrine';

export interface Chunk {
  id: string;
  /** Repo-relative source, so an answer can always be traced back. */
  sourcePath: string;
  /** The module name a rep would recognise: 'module-07-objection-handling'. */
  moduleId: string;
  heading: string;
  headingPath: string[];
  text: string;
  authority: ChunkAuthority;
  tokens: string[];
}

export interface KnowledgeIndex {
  chunks: Chunk[];
  documentFrequency: Map<string, number>;
  averageLength: number;
  /** Recorded per the spec so a retrieved answer can be attributed to a build. */
  snapshot: {
    indexVersion: string;
    chunkingVersion: string;
    sourcePaths: string[];
    fileCount: number;
    chunkCount: number;
    corpusSha256: string;
    generatedAt: string;
  };
}

export const INDEX_VERSION = 'lexical-bm25-v1';
export const CHUNKING_VERSION = 'heading-v1';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'this', 'that', 'these',
  'those', 'you', 'your', 'they', 'their', 'we', 'our', 'as', 'by', 'from', 'not',
  'do', 'does', 'did', 'can', 'will', 'would', 'should', 'what', 'how', 'when',
  'who', 'which', 'there', 'here', 'about', 'into', 'than', 'then', 'so', 'i',
]);

export function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, ''))
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function listMarkdown(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (EXCLUDED_PATTERNS.some((pattern) => pattern.test(full))) continue;
      const stats = statSync(full);
      if (stats.isDirectory()) walk(full);
      else if (entry.endsWith('.md')) found.push(full);
    }
  };
  const stats = statSync(root);
  if (stats.isDirectory()) walk(root);
  else if (root.endsWith('.md')) found.push(root);
  return found.sort();
}

/**
 * Splits a document at its headings.
 *
 * A heading is the unit a person would cite -- "the gatekeeper section of module 4"
 * -- so it is the unit retrieved. A section longer than the window is split at
 * paragraph boundaries rather than mid-sentence, because half a sentence of doctrine
 * is worse than none.
 */
function chunkDocument(
  sourcePath: string, text: string, authority: ChunkAuthority, maxChars = 2_400,
): Chunk[] {
  const moduleId = sourcePath.split('/').pop()!.replace(/\.md$/, '');
  const lines = text.split('\n');
  const chunks: Chunk[] = [];
  const headingStack: string[] = [];
  let buffer: string[] = [];
  let currentHeading = moduleId;

  const flush = (): void => {
    const body = buffer.join('\n').trim();
    buffer = [];
    if (body.length < 40) return;
    const pieces: string[] = [];
    if (body.length <= maxChars) pieces.push(body);
    else {
      let piece = '';
      for (const paragraph of body.split(/\n{2,}/)) {
        if (piece.length + paragraph.length > maxChars && piece) {
          pieces.push(piece.trim());
          piece = '';
        }
        piece += `${paragraph}\n\n`;
      }
      if (piece.trim()) pieces.push(piece.trim());
    }
    for (const [index, piece] of pieces.entries()) {
      chunks.push({
        id: `${moduleId}#${chunks.length}-${index}`,
        sourcePath, moduleId, heading: currentHeading,
        headingPath: [...headingStack], text: piece, authority,
        tokens: tokenize(`${headingStack.join(' ')} ${currentHeading} ${piece}`),
      });
    }
  };

  for (const line of lines) {
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const depth = heading[1]!.length;
      headingStack.length = Math.max(0, depth - 1);
      headingStack[depth - 1] = heading[2]!.trim();
      currentHeading = heading[2]!.trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return chunks;
}

export function buildIndex(root = repoRoot): KnowledgeIndex {
  const chunks: Chunk[] = [];
  const files: string[] = [];
  const hash = createHash('sha256');

  for (const source of CORPUS_PATHS) {
    const absolute = resolve(root, source.path);
    for (const file of listMarkdown(absolute)) {
      const text = readFileSync(file, 'utf8');
      hash.update(text);
      files.push(relative(root, file));
      chunks.push(...chunkDocument(relative(root, file), text, source.authority));
    }
  }

  const documentFrequency = new Map<string, number>();
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.tokens.length;
    for (const token of new Set(chunk.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  return {
    chunks, documentFrequency,
    averageLength: chunks.length > 0 ? totalLength / chunks.length : 0,
    snapshot: {
      indexVersion: INDEX_VERSION, chunkingVersion: CHUNKING_VERSION,
      sourcePaths: CORPUS_PATHS.map((source) => source.path),
      fileCount: files.length, chunkCount: chunks.length,
      corpusSha256: hash.digest('hex'), generatedAt: new Date().toISOString(),
    },
  };
}

export interface RetrievalHit {
  chunk: Chunk;
  score: number;
}

export interface RetrieveOptions {
  limit?: number;
  /**
   * True when the question is about what we sell or what it costs. Commercial truth
   * comes from launch-decisions, so those chunks outrank the manual's -- the manual
   * is doctrine, and the examples in it go out of date.
   */
  commercialTruthRequired?: boolean;
  /** Restrict to one module, for a vertical-specific question. */
  moduleId?: string | null;
}

const K1 = 1.4;
const B = 0.72;
/**
 * A term in the heading counts for more than the same term in the body.
 *
 * A section heading says what the section is about; the same words in a paragraph
 * may be an aside. The weight was chosen by sweeping it against the evaluation set
 * rather than picked: at 1.0 precision@1 was 6 of 19 and recall@5 16; at 1.3,
 * 9 and 15; above 1.6 both fell, because a heading that happens to share one word
 * started outranking the section that answers the question. 1.3 buys three places
 * at the top for one at the bottom, and that trade is the right way round for a rep
 * who reads the first result.
 */
const HEADING_WEIGHT = 1.3;

/**
 * The vocabulary a commercial question is really asking about, whatever words the
 * asker used. "How much do we charge" shares no token with launch-decisions, so
 * without this the precedence rule could not apply -- there was nothing to apply it
 * to, and the answer came from the manual.
 */
const COMMERCIAL_VOCABULARY = [
  'price', 'pricing', 'cost', 'fee', 'retainer', 'package', 'offer', 'offers',
  'investment', 'monthly', 'engagement',
];

/** BM25 with a heading field boost. Nothing is retrieved that matches nothing. */
export function retrieve(
  index: KnowledgeIndex, question: string, options: RetrieveOptions = {},
): RetrievalHit[] {
  const limit = options.limit ?? 5;
  const queryTokens = tokenize(question);
  if (queryTokens.length === 0) return [];
  const total = index.chunks.length;

  // A commercial question is scored against the words it used plus the words the
  // company uses for the same thing, but only inside launch decisions.
  const commercialTokens = options.commercialTruthRequired
    ? new Set([...queryTokens, ...COMMERCIAL_VOCABULARY]) : null;

  const scored: RetrievalHit[] = [];
  for (const chunk of index.chunks) {
    if (options.moduleId && chunk.moduleId !== options.moduleId) continue;
    const frequencies = new Map<string, number>();
    for (const token of chunk.tokens) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }
    const headingTokens = new Set(tokenize(`${chunk.headingPath.join(' ')} ${chunk.heading}`));
    const terms = commercialTokens && chunk.authority === 'commercial_truth'
      ? commercialTokens : new Set(queryTokens);

    let score = 0;
    let matched = 0;
    for (const token of terms) {
      const frequency = frequencies.get(token);
      if (!frequency) continue;
      if (queryTokens.includes(token)) matched += 1;
      const documents = index.documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (total - documents + 0.5) / (documents + 0.5));
      const norm = 1 - B + B * (chunk.tokens.length / (index.averageLength || 1));
      const weight = headingTokens.has(token) ? HEADING_WEIGHT : 1;
      score += weight * idf * ((frequency * (K1 + 1)) / (frequency + K1 * norm));
    }
    if (score === 0) continue;
    // A chunk matching more of the question is more likely to be the answer than one
    // matching a single rare word many times.
    score *= 1 + (matched / queryTokens.length) * 0.5;
    if (options.commercialTruthRequired && chunk.authority === 'commercial_truth') {
      // Launch decisions win on price and offer questions. Not a tie-break: the
      // manual must not be able to outscore them by repeating a stale number.
      score += 1_000;
    }
    scored.push({ chunk, score });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * What a live turn is allowed to be given.
 *
 * The spec is explicit that the whole manual must never be dumped into a realtime
 * context. One or two chunks, trimmed, with their sources, is what a voice turn gets.
 */
export const LIVE_TURN_CHAR_BUDGET = 1_200;

export function liveTurnContext(
  index: KnowledgeIndex, question: string, options: RetrieveOptions = {},
): { text: string; sources: string[] } | null {
  const hits = retrieve(index, question, { ...options, limit: 2 });
  if (hits.length === 0) return null;
  let text = '';
  const sources: string[] = [];
  for (const hit of hits) {
    const remaining = LIVE_TURN_CHAR_BUDGET - text.length;
    if (remaining < 200) break;
    text += `${hit.chunk.text.slice(0, remaining)}\n\n`;
    sources.push(`${hit.chunk.sourcePath}#${hit.chunk.heading}`);
  }
  return { text: text.trim().slice(0, LIVE_TURN_CHAR_BUDGET), sources };
}
