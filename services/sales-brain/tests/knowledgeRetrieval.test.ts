import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndex, retrieve, liveTurnContext, tokenize, CORPUS_PATHS, EXCLUDED_PATTERNS,
  INDEX_VERSION, LIVE_TURN_CHAR_BUDGET, type KnowledgeIndex,
} from '../src/knowledge/index.js';

/**
 * Retrieval evaluation over the Sales Manual.
 * Authority: outbound-sales-brain-sales-manual-rag-spec.md.
 *
 * The manual is the most expensive artefact in this repository. An index that
 * retrieves the wrong module is worse than no index, because a rep or an agent will
 * act on what it returns. So this is an evaluation set with expected and forbidden
 * answers per query, scored, rather than a handful of spot checks.
 *
 * No database and no credential: the index is built from the repository.
 */

let index: KnowledgeIndex | null = null;
function corpus(): KnowledgeIndex {
  index ??= buildIndex();
  return index;
}

interface EvalCase {
  /** What a rep or the pre-call brain would ask. */
  query: string;
  /** At least one of these must appear in the top results. */
  expectModules: string[];
  /** None of these may appear: retrieving them would answer the wrong question. */
  forbidModules?: string[];
  /** The answer has to come from launch decisions, not from the manual's examples. */
  commercialTruth?: boolean;
  /** Words the top result should contain, for questions with a specific answer. */
  expectText?: RegExp;
  /**
   * The manual does not cover this yet. Recorded so the score reflects retrieval
   * rather than coverage -- and the last test in this file fails if the gap is
   * filled, so the list cannot quietly go stale.
   */
  knownGap?: string;
}

/**
 * The evaluation set. Twenty-one queries covering the situations the spec names:
 * the openers, the objections, the verticals, and the things that must never be
 * answered from doctrine at all.
 */
const EVAL: EvalCase[] = [
  // Twenty-eight vertical playbooks each carry a COLD CALL section, so a query with
  // no vertical in it is genuinely ambiguous: a playbook's cold-call script is a
  // correct answer to "what do I open with". Both are accepted; what must not
  // happen is a closing module answering an opening question.
  { query: 'cold call opening line for a first call',
    expectModules: ['module-04a-cold-calling-and-prospecting', 'module-05-hooks-and-opening-angles',
                    'module-10-hvac-industry-playbook', 'module-11-plumbing-industry-playbook',
                    'module-12-roofing-industry-playbook', 'module-13-collision-repair-industry-playbook',
                    'module-18-dental-industry-playbook', 'module-20-automotive-dealerships-industry-playbook',
                    'module-30-restoration-industry-playbook'],
    forbidModules: ['module-09-proposal-presentation-and-closing'] },
  { query: 'the receptionist will not put me through to the owner',
    expectModules: ['module-04a-cold-calling-and-prospecting'],
    expectText: /gatekeeper|receptionist/i },
  { query: 'HVAC company missing calls after hours',
    expectModules: ['module-10-hvac-industry-playbook'],
    forbidModules: ['module-18-dental-industry-playbook', 'module-15-law-firms-industry-playbook'] },
  { query: 'roofing company not following up on estimates',
    expectModules: ['module-12-roofing-industry-playbook'],
    forbidModules: ['module-10-hvac-industry-playbook'] },
  { query: 'body shop estimate follow up collision repair',
    expectModules: ['module-13-collision-repair-industry-playbook'],
    forbidModules: ['module-12-roofing-industry-playbook'] },
  { query: 'law firm intake calls going to voicemail',
    expectModules: ['module-15-law-firms-industry-playbook'],
    forbidModules: ['module-10-hvac-industry-playbook'] },
  { query: 'real estate agent responding to portal leads',
    expectModules: ['module-26-real-estate-brokerages-industry-playbook'] },
  { query: 'they say they already have a CRM',
    expectModules: ['module-07-objection-handling', 'module-03b-crm-fundamentals-for-salespeople',
                    'module-08-competitive-positioning'] },
  { query: 'they say they already have a receptionist who answers the phone',
    expectModules: ['module-07-objection-handling', 'module-04a-cold-calling-and-prospecting'] },
  { query: 'they do not want a robot talking to their customers',
    expectModules: ['module-07-objection-handling', 'module-08-competitive-positioning'] },
  // A commercial question: the facts come from launch decisions, and the ranking
  // guarantees they come first, so that is what this expects.
  { query: 'they ask what it costs on the first call',
    expectModules: ['launch-decisions'], commercialTruth: true },
  { query: 'what is the price of the AI department',
    expectModules: [], commercialTruth: true },
  { query: 'how do I work out the return on investment for them',
    expectModules: ['module-02b-roi-calculator-playbook', 'module-02a-business-economics'] },
  { query: 'they ask me to send them an email instead',
    expectModules: ['module-07-objection-handling', 'module-04a-cold-calling-and-prospecting'] },
  { query: 'they tell me to take them off the list do not call again',
    expectModules: ['module-04a-cold-calling-and-prospecting', 'module-01-sales-doctrine'] },
  { query: 'wrong number this is not that business',
    expectModules: ['module-04a-cold-calling-and-prospecting'],
    knownGap: 'The manual has no wrong-number section. The behaviour is specified in '
      + 'the Sales AI response cards, not in the training manual.' },
  { query: 'booking the next meeting and confirming the time',
    expectModules: ['module-09-proposal-presentation-and-closing',
                    'module-03-discovery-and-financial-diagnosis',
                    'module-04a-cold-calling-and-prospecting'] },
  { query: 'there is no business case here they are too small',
    expectModules: ['module-04c-prospect-qualification-and-target-scoring',
                    'module-03-discovery-and-financial-diagnosis',
                    'module-01-sales-doctrine', 'module-04a-cold-calling-and-prospecting',
                    'module-02a-business-economics'] },
  { query: 'they are worried this replaces their employees',
    expectModules: ['module-07-objection-handling', 'module-01-sales-doctrine',
                    'module-08-competitive-positioning'] },
  { query: 'they want to see a case study or proof it works',
    expectModules: ['module-07-objection-handling', 'module-01-sales-doctrine',
                    'module-06-story-and-visualization-selling'] },
  { query: 'fair housing rules when selling to a property manager',
    expectModules: ['module-21-property-management-industry-playbook',
                    'module-26-real-estate-brokerages-industry-playbook',
                    'module-01-sales-doctrine'] },
];

// --- the index itself --------------------------------------------------------------

test('the index reads the manual and nothing else', () => {
  const built = corpus();
  assert.ok(built.snapshot.fileCount > 40, `only ${built.snapshot.fileCount} files indexed`);
  assert.ok(built.snapshot.chunkCount > 800, `only ${built.snapshot.chunkCount} chunks`);

  // Only the paths the spec names. An old brainstorming document with a superseded
  // price must not be able to answer a question about price.
  const sources = new Set(built.chunks.map((chunk) => chunk.sourcePath.split('/').slice(0, 3).join('/')));
  for (const source of sources) {
    const allowed = CORPUS_PATHS.some(({ path }) =>
      source.startsWith(path) || path.startsWith(source));
    assert.ok(allowed, `${source} is indexed but is not in the corpus`);
  }
  for (const chunk of built.chunks) {
    for (const pattern of EXCLUDED_PATTERNS) {
      assert.equal(pattern.test(chunk.sourcePath), false,
        `${chunk.sourcePath} matches an exclusion`);
    }
  }
});

test('the snapshot records what was indexed, so an answer can be attributed', () => {
  const built = corpus();
  assert.equal(built.snapshot.indexVersion, INDEX_VERSION);
  assert.match(built.snapshot.corpusSha256, /^[0-9a-f]{64}$/);
  assert.ok(built.snapshot.sourcePaths.length >= 2);
  // The same corpus gives the same hash, so a changed answer can be traced to a
  // changed manual rather than a changed retriever.
  assert.equal(buildIndex().snapshot.corpusSha256, built.snapshot.corpusSha256);
});

test('a chunk carries where it came from and what section it is', () => {
  const built = corpus();
  for (const chunk of built.chunks.slice(0, 200)) {
    assert.ok(chunk.sourcePath.endsWith('.md'));
    assert.ok(chunk.moduleId.length > 0);
    assert.ok(chunk.heading.length > 0, `${chunk.id} has no heading`);
    assert.ok(chunk.text.length >= 40);
  }
});

// --- the evaluation ------------------------------------------------------------------

test('the retrieval evaluation set scores above its floor', () => {
  const built = corpus();
  const results: { query: string; hitAt: number | null; forbidden: string[];
                   knownGap: string | null }[] = [];

  for (const item of EVAL) {
    const hits = retrieve(built, item.query, {
      limit: 5, commercialTruthRequired: item.commercialTruth ?? false,
    });
    const modules = hits.map((hit) => hit.chunk.moduleId);

    let hitAt: number | null = null;
    if (item.expectModules.length === 0) {
      hitAt = 1; // Nothing to expect: this query is judged on its forbidden set.
    } else {
      const index_ = modules.findIndex((module) => item.expectModules.includes(module));
      hitAt = index_ === -1 ? null : index_ + 1;
    }
    const forbidden = modules.filter((module) => item.forbidModules?.includes(module));
    results.push({ query: item.query, hitAt, forbidden, knownGap: item.knownGap ?? null });
  }

  const scored = results.filter((row) => !row.knownGap);
  const atOne = scored.filter((row) => row.hitAt === 1).length;
  const atFive = scored.filter((row) => row.hitAt !== null).length;
  const withForbidden = results.filter((row) => row.forbidden.length > 0);

  const misses = scored.filter((row) => row.hitAt === null)
    .map((row) => `  MISS  ${row.query}`);
  const gaps = results.filter((row) => row.knownGap)
    .map((row) => `  GAP   ${row.query} — ${row.knownGap}`);
  const wrong = withForbidden.map((row) =>
    `  WRONG ${row.query} -> ${row.forbidden.join(', ')}`);

  // Reported whether or not it passes, so a regression is legible rather than a
  // single failing number.
  const report = [
    `precision@1: ${atOne}/${scored.length} (${Math.round((atOne / scored.length) * 100)}%)`,
    `recall@5:    ${atFive}/${scored.length} (${Math.round((atFive / scored.length) * 100)}%)`,
    `forbidden:   ${withForbidden.length}`,
    `known gaps:  ${gaps.length} (not scored)`,
    ...misses, ...wrong, ...gaps,
  ].join('\n');

  assert.equal(withForbidden.length, 0,
    `retrieval returned a module that answers the wrong question:\n${report}`);
  assert.ok(atFive >= Math.ceil(scored.length * 0.85),
    `recall@5 below the floor:\n${report}`);
  assert.ok(atOne >= Math.ceil(scored.length * 0.55),
    `precision@1 below the floor:\n${report}`);
});

// --- the rules the spec puts above relevance -------------------------------------

test('a price question is answered from launch decisions, not from the manual',
  () => {
    const built = corpus();
    for (const question of ['what does the AI department cost',
                            'what is our price', 'how much do we charge',
                            'what are the packages we sell']) {
      const hits = retrieve(built, question, { limit: 3, commercialTruthRequired: true });
      assert.ok(hits.length > 0, `"${question}" retrieved nothing`);
      assert.equal(hits[0]!.chunk.authority, 'commercial_truth',
        `"${question}" was answered from ${hits[0]!.chunk.sourcePath}`);
      assert.match(hits[0]!.chunk.sourcePath, /launch-decisions\.md$/);
    }
  });

test('doctrine cannot outrank commercial truth by repeating a number', () => {
  const built = corpus();
  // Even a manual chunk stuffed with the exact words of the question loses.
  const hits = retrieve(built, 'price pricing cost package offer monthly retainer',
    { limit: 5, commercialTruthRequired: true });
  assert.equal(hits[0]!.chunk.authority, 'commercial_truth');
  const doctrineAbove = hits.findIndex((hit) => hit.chunk.authority === 'doctrine');
  const truthCount = hits.filter((hit) => hit.chunk.authority === 'commercial_truth').length;
  assert.ok(doctrineAbove === -1 || doctrineAbove >= truthCount,
    'a manual chunk outranked launch decisions on a commercial question');
});

test('a live turn is given a small answer, never the manual', () => {
  const built = corpus();
  const context = liveTurnContext(built, 'they said they already use ServiceTitan');
  assert.ok(context, 'a live turn got nothing');
  assert.ok(context!.text.length <= LIVE_TURN_CHAR_BUDGET,
    `a live turn was given ${context!.text.length} characters`);
  assert.ok(context!.sources.length >= 1, 'a live answer has no source');
  assert.ok(context!.sources.length <= 2, 'a live turn was given more than two sources');
  // And what it got is a fraction of a percent of the corpus.
  const corpusChars = built.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  assert.ok(context!.text.length / corpusChars < 0.01,
    'a live turn was given a meaningful fraction of the whole manual');
});

test('a question with no answer in the manual retrieves nothing rather than guessing',
  () => {
    const built = corpus();
    for (const question of ['zzzzzz qqqqqq', '', '   ']) {
      assert.deepEqual(retrieve(built, question), [],
        `"${question}" retrieved something`);
    }
  });

test('a vertical question can be pinned to its own playbook', () => {
  const built = corpus();
  const hits = retrieve(built, 'what do I ask them first',
    { limit: 3, moduleId: 'module-10-hvac-industry-playbook' });
  assert.ok(hits.length > 0);
  for (const hit of hits) {
    assert.equal(hit.chunk.moduleId, 'module-10-hvac-industry-playbook',
      'a pinned retrieval escaped its module');
  }
});

test('tokenisation keeps the words that carry the meaning', () => {
  const tokens = tokenize('What do I say if they already use ServiceTitan?');
  assert.ok(tokens.includes('servicetitan'), 'the product name was dropped');
  assert.ok(tokens.includes('say'));
  assert.equal(tokens.includes('the'), false, 'a stop word survived');
  assert.equal(tokens.includes('i'), false);
});


test('a known gap in the manual is still a gap', () => {
  // If somebody writes the missing section, this fails and the gap comes off the
  // list -- so the evaluation cannot quietly stop measuring what it excused.
  const built = corpus();
  for (const item of EVAL.filter((row) => row.knownGap)) {
    const hits = retrieve(built, item.query, { limit: 5 });
    const found = hits.some((hit) => item.expectModules.includes(hit.chunk.moduleId));
    assert.equal(found, false,
      `"${item.query}" now retrieves ${item.expectModules.join(' or ')}. `
      + 'Remove its knownGap so it is scored again.');
  }
});
