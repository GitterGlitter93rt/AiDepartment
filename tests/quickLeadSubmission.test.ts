// Quick Score lead submission test suite.
// Run with: node --experimental-strip-types --test tests/quickLeadSubmission.test.ts
//
// Covers the quick-score (assessment_quick_v1) Web3Forms delivery:
// contact validation, payload structure, rep + marketing attribution
// inclusion, GA4 field hygiene, and genuine-delivery semantics. Also
// re-verifies that the full engine's submission (leadSubmission.ts)
// now carries rep attribution additively.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}
(globalThis as any).window = { localStorage: new MemoryStorage() };
(globalThis as any).document = { referrer: '' };

import { runQuickScore } from '../src/lib/assessment/quickScore.ts';
import { QUICK_QUESTIONS } from '../src/data/assessment/quickQuestions.ts';
import type { QuickAnswerMap } from '../src/data/assessment/quickTypes.ts';
import {
  validateQuickContact,
  buildQuickAnswerSummary,
  buildQuickLeadAnalyticsFields,
  submitQuickLead,
} from '../src/lib/assessment/quickLeadSubmission.ts';
import { captureRepAttribution } from '../src/lib/repAttribution.ts';
import { runAssessment } from '../src/lib/assessment/runAssessment.ts';
import { QUESTIONS } from '../src/data/assessment/questions.ts';
import type { AnswerMap } from '../src/data/assessment/types.ts';
import { submitAssessmentLead } from '../src/lib/assessment/leadSubmission.ts';
import type { QuickContactInfo } from '../src/lib/assessment/quickPersistence.ts';
import type { ContactInfo } from '../src/lib/assessment/persistence.ts';

const QUICK_ANSWERS: QuickAnswerMap = {
  QS1: 'Professional Services',
  QS2: '11-25',
  QS3: 'No',
  QS4: 'Very important',
  QS5: 'We cannot track it',
  QS6: 'Dissatisfied',
  QS7: '30-60 minutes',
  QS8: 'Usually nothing',
  QS9: '10-25%',
  QS10: 'Same business day',
  QS11: 'Significant amount',
  QS12: 'Under 10%',
  QS13: 'Mostly disconnected',
  QS14: 'Reporting is mostly manual',
  QS15: '1-3 months',
};

const QUICK_CONTACT: QuickContactInfo = {
  firstName: 'Alex',
  lastName: 'Chen',
  email: 'alex@example.com',
  company: 'Example Co',
  phone: '555-0100',
  website: 'https://example.com',
  marketingOptIn: false,
};

// Full-engine fixtures (same shape as the existing suites) used only
// for the additive rep-attribution check.
const FULL_ANSWERS: AnswerMap = {
  Q1: 'Professional Services', Q2: '$1-$3 million', Q3: '11-25', Q4: '1', Q5: ['Increase revenue'],
  Q6: 'Moderate', Q7: 'We are currently developing one', Q8: 'A department leader owns it', Q9: 'Important',
  Q10: ['Referrals'], Q11: '$0', Q12: 'Very confident', Q13: 'Satisfied', Q14: 'Yes, regularly',
  Q15: 'Yes, consistently', Q16: 'Under 5 minutes', Q17: 'We have sophisticated automated nurturing',
  Q18: '25-100', Q19: 'Yes, consistently',
  Q20: 'Almost none', Q21: 'AI voice agent', Q22: 'Within minutes', Q23: 'Yes, integrated with CRM and follow-up',
  Q24: 'Some', Q25: ['None of these'], Q26: 'Most', Q27: 'Rarely', Q28: 'No',
  Q29: '51-75%', Q30: ['ChatGPT'], Q31: 'Company-wide training exists', Q32: 'Yes, formal policy exists', Q33: 'Slightly concerned',
  Q34: 'Well integrated', Q35: 'Good visibility', Q36: 'Good', Q37: 'Regularly',
  Q38: '3-6 months', Q39: '$5,000-$10,000', Q40: 'Employee',
  Q41: 'Nothing malicious here', Q42: 'Growth',
  Q60: 'Several workflows', Q61: ['Unsure'],
};

const FULL_CONTACT: ContactInfo = {
  firstName: 'Jamie',
  lastName: 'Rivera',
  email: 'jamie@example.com',
  company: 'Example Co',
  phone: '555-0100',
  website: 'https://example.com',
  marketingOptIn: false,
};

function withMockedFetch<T>(mockImpl: (input: any, init: any) => Promise<any>, fn: () => Promise<T>): Promise<T> {
  const original = (globalThis as any).fetch;
  (globalThis as any).fetch = mockImpl;
  return fn().finally(() => {
    (globalThis as any).fetch = original;
  });
}

describe('1. Quick contact validation', () => {
  test('rejects missing required fields', () => {
    assert.ok(validateQuickContact({ firstName: '', email: 'a@b.com', company: 'Co' }));
    assert.ok(validateQuickContact({ firstName: 'Alex', email: '', company: 'Co' }));
    assert.ok(validateQuickContact({ firstName: 'Alex', email: 'a@b.com', company: '' }));
  });

  test('accepts a valid contact', () => {
    assert.equal(validateQuickContact({ firstName: 'Alex', email: 'a@b.com', company: 'Co' }), null);
  });
});

describe('2. Quick payload structure', () => {
  test('answer summary uses real prompts and labels, not raw IDs', () => {
    const summary = buildQuickAnswerSummary(QUICK_ANSWERS, QUICK_QUESTIONS);
    assert.ok(summary.includes('Professional Services'));
    assert.ok(summary.includes('How quickly does your team typically respond to a new inbound lead?'));
    assert.equal(summary.trim().startsWith('{'), false);
  });

  test('payload carries score, stage, signals, answers, and a distinct subject', async () => {
    (globalThis as any).window.localStorage = new MemoryStorage(); // clean session

    let capturedBody: any = null;
    const result = runQuickScore(QUICK_ANSWERS);
    await withMockedFetch(
      async (_url, init) => {
        capturedBody = JSON.parse(init.body);
        return { ok: true, json: async () => ({ success: true }) };
      },
      () => submitQuickLead({ contact: QUICK_CONTACT, result, answers: QUICK_ANSWERS, questions: QUICK_QUESTIONS })
    );

    assert.ok(capturedBody.subject.includes('AI Quick Score Lead'));
    assert.equal(capturedBody.first_name, 'Alex');
    assert.equal(capturedBody.email, 'alex@example.com');
    assert.equal(capturedBody.assessment_version, 'assessment_quick_v1');
    assert.equal(capturedBody.overall_score, String(result.overallScore));
    assert.equal(capturedBody.maturity_stage, result.stage);
    assert.ok(capturedBody.category_scores.length > 0);
    assert.ok(capturedBody.opportunity_signals.length > 0);
    assert.ok(capturedBody.answer_summary.length > 0);
    assert.ok(capturedBody.lead_id.length > 0);
    // Lead summary block must include the private urgency context for
    // the salesperson and the score itself.
    assert.ok(capturedBody.lead_summary.includes('Overall AI Score'));
    assert.ok(capturedBody.lead_summary.includes('Internal Urgency (0-5)'));
  });
});

describe('3. Rep attribution in lead payloads', () => {
  test('quick lead carries rep_code and a readable Sales Rep line when captured', async () => {
    (globalThis as any).window.localStorage = new MemoryStorage();
    captureRepAttribution({ search: '?rep=michael' });

    let capturedBody: any = null;
    const result = runQuickScore(QUICK_ANSWERS);
    await withMockedFetch(
      async (_url, init) => {
        capturedBody = JSON.parse(init.body);
        return { ok: true, json: async () => ({ success: true }) };
      },
      () => submitQuickLead({ contact: QUICK_CONTACT, result, answers: QUICK_ANSWERS, questions: QUICK_QUESTIONS })
    );

    assert.equal(capturedBody.rep_code, 'michael');
    assert.ok(capturedBody.lead_summary.includes('Sales Rep: michael'));
  });

  test('no rep captured -> no rep_code field and an explicit none line', async () => {
    (globalThis as any).window.localStorage = new MemoryStorage();

    let capturedBody: any = null;
    const result = runQuickScore(QUICK_ANSWERS);
    await withMockedFetch(
      async (_url, init) => {
        capturedBody = JSON.parse(init.body);
        return { ok: true, json: async () => ({ success: true }) };
      },
      () => submitQuickLead({ contact: QUICK_CONTACT, result, answers: QUICK_ANSWERS, questions: QUICK_QUESTIONS })
    );

    assert.equal('rep_code' in capturedBody, false);
    assert.ok(capturedBody.lead_summary.includes('Sales Rep: none captured'));
  });

  test('full-engine submission (leadSubmission.ts) also carries rep attribution additively', async () => {
    (globalThis as any).window.localStorage = new MemoryStorage();
    captureRepAttribution({ search: '?rep=sarah' });

    let capturedBody: any = null;
    const fullResult = runAssessment(FULL_ANSWERS);
    await withMockedFetch(
      async (_url, init) => {
        capturedBody = JSON.parse(init.body);
        return { ok: true, json: async () => ({ success: true }) };
      },
      () => submitAssessmentLead({ contact: FULL_CONTACT, result: fullResult, answers: FULL_ANSWERS, questions: QUESTIONS })
    );

    assert.equal(capturedBody.rep_code, 'sarah');
    assert.ok(capturedBody.lead_summary.includes('Sales Rep: sarah'));
    // Existing contract unchanged: subject and core fields intact.
    assert.ok(capturedBody.subject.includes('AI Assessment Lead'));
    assert.equal(capturedBody.overall_score, String(fullResult.public.overallScore));
  });

  test('full-engine submission without a rep keeps its historical shape', async () => {
    (globalThis as any).window.localStorage = new MemoryStorage();

    let capturedBody: any = null;
    const fullResult = runAssessment(FULL_ANSWERS);
    await withMockedFetch(
      async (_url, init) => {
        capturedBody = JSON.parse(init.body);
        return { ok: true, json: async () => ({ success: true }) };
      },
      () => submitAssessmentLead({ contact: FULL_CONTACT, result: fullResult, answers: FULL_ANSWERS, questions: QUESTIONS })
    );

    assert.equal('rep_code' in capturedBody, false);
    assert.ok(capturedBody.lead_summary.includes('Sales Rep: none captured'));
  });
});

describe('4. GA4 analytics hygiene', () => {
  test('buildQuickLeadAnalyticsFields carries no PII', () => {
    const result = runQuickScore(QUICK_ANSWERS);
    const fields = buildQuickLeadAnalyticsFields('lead-abc-123', result);
    const forbidden = ['firstname', 'lastname', 'email', 'phone', 'company', 'website', 'name', 'answer'];
    for (const key of Object.keys(fields)) {
      const lower = key.toLowerCase();
      for (const bad of forbidden) {
        assert.equal(lower.includes(bad), false, `analytics field "${key}" looks like it could contain PII`);
      }
    }
    assert.equal(fields.lead_id, 'lead-abc-123');
  });

  test('free funnel GA4 params use the shared event family and short_v1 version', () => {
    const result = runQuickScore(QUICK_ANSWERS);
    const fields = buildQuickLeadAnalyticsFields('lead-abc-123', result);
    assert.equal(fields.assessment_type, 'free_opportunity');
    assert.equal(fields.assessment_version, 'short_v1');
    assert.ok(['low', 'medium', 'high'].includes(fields.score_band));
  });
});

describe('5. Genuine-delivery semantics', () => {
  test('backend success -> delivered true', async () => {
    (globalThis as any).window.localStorage = new MemoryStorage();
    const result = runQuickScore(QUICK_ANSWERS);
    const outcome = await withMockedFetch(
      async () => ({ ok: true, json: async () => ({ success: true }) }),
      () => submitQuickLead({ contact: QUICK_CONTACT, result, answers: QUICK_ANSWERS, questions: QUICK_QUESTIONS })
    );
    assert.equal(outcome.delivered, true);
    assert.ok(outcome.leadId.length > 0);
  });

  test('backend failure -> delivered false (never falsely reports success)', async () => {
    (globalThis as any).window.localStorage = new MemoryStorage();
    const result = runQuickScore(QUICK_ANSWERS);
    const outcome = await withMockedFetch(
      async () => ({ ok: false, json: async () => ({ success: false }) }),
      () => submitQuickLead({ contact: QUICK_CONTACT, result, answers: QUICK_ANSWERS, questions: QUICK_QUESTIONS })
    );
    assert.equal(outcome.delivered, false);
  });

  test('network throw -> delivered false, no exception escapes', async () => {
    (globalThis as any).window.localStorage = new MemoryStorage();
    const result = runQuickScore(QUICK_ANSWERS);
    const outcome = await withMockedFetch(
      async () => {
        throw new Error('network down');
      },
      () => submitQuickLead({ contact: QUICK_CONTACT, result, answers: QUICK_ANSWERS, questions: QUICK_QUESTIONS })
    );
    assert.equal(outcome.delivered, false);
  });
});
