// Client-side Free Opportunity Assessment engine (Quick Score).
// SEPARATE from the 64-question AssessmentApp (assessmentApp.ts), which
// is preserved unchanged and served from /ai-assessment/full/. This
// component implements the 15-question free scoring model at
// /free-ai-assessment/: one question at a time, contact gate, then an
// inline results view. Structured typed configuration drives rendering
// — no per-question UI components, same architecture rule as the full
// engine.
//
// GA4: uses the SHARED assessment event family (ai_assessment_start /
// ai_assessment_complete / ai_assessment_lead_submit) with
// assessment_type "free_opportunity" and assessment_version "short_v1"
// — see src/lib/assessment/ga4Events.ts.

import { QUICK_QUESTIONS } from '../../data/assessment/quickQuestions';
import {
  QUICK_ASSESSMENT_VERSION,
  type QuickAnswerMap,
  type QuickResult,
} from '../../data/assessment/quickTypes';
import { runQuickScore } from '../../lib/assessment/quickScore';
import {
  saveQuickDraft,
  loadQuickDraft,
  clearQuickDraft,
  saveQuickResult,
  saveQuickContact,
  type QuickContactInfo,
} from '../../lib/assessment/quickPersistence';
import { submitQuickLead, validateQuickContact } from '../../lib/assessment/quickLeadSubmission';
import {
  ASSESSMENT_EVENTS,
  ASSESSMENT_TYPE,
  buildAssessmentCompleteParams,
  buildAssessmentLeadSubmitParams,
} from '../../lib/assessment/ga4Events';
import { SCHEDULING } from '../../lib/scheduling';

type ViewState = 'intro' | 'question' | 'contact' | 'submitting' | 'submit-error' | 'results';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class QuickAssessmentApp {
  private root: HTMLElement;
  private answers: QuickAnswerMap = {};
  private currentId: string;
  private state: ViewState = 'intro';
  private validationMessage: string | null = null;
  // Preserved across a failed submission so retry never loses contact
  // info or answers.
  private pendingContact: QuickContactInfo | null = null;
  private pendingResult: QuickResult | null = null;
  private isSubmitting = false;

  constructor(root: HTMLElement) {
    this.root = root;
    const draft = loadQuickDraft();
    if (draft) this.answers = draft;
    const firstUnanswered = QUICK_QUESTIONS.find((q) => !this.isAnswered(q.id));
    this.currentId = firstUnanswered?.id ?? QUICK_QUESTIONS[QUICK_QUESTIONS.length - 1].id;
    // If everything is already answered (a returning user), go straight
    // to the contact/results path rather than replaying question 15.
    if (firstUnanswered === undefined) {
      this.state = 'contact';
    }
    this.render();
  }

  private get currentIndex(): number {
    const idx = QUICK_QUESTIONS.findIndex((q) => q.id === this.currentId);
    return idx < 0 ? 0 : idx;
  }

  private get currentQuestion() {
    return QUICK_QUESTIONS[this.currentIndex];
  }

  private isAnswered(qid: string): boolean {
    const val = this.answers[qid];
    return typeof val === 'string' && val.length > 0;
  }

  private scrollToTop() {
    this.root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private startQuiz = () => {
    this.state = 'question';
    this.render();
  };

  private goNext = () => {
    if (!this.isAnswered(this.currentQuestion.id)) {
      this.validationMessage = 'Please answer this question to continue.';
      this.render();
      return;
    }
    this.validationMessage = null;
    saveQuickDraft(this.answers);
    const idx = this.currentIndex;
    if (idx < QUICK_QUESTIONS.length - 1) {
      this.currentId = QUICK_QUESTIONS[idx + 1].id;
      this.render();
    } else {
      this.state = 'contact';
      this.render();
    }
    this.scrollToTop();
  };

  private goPrevious = () => {
    const idx = this.currentIndex;
    if (idx > 0) {
      this.currentId = QUICK_QUESTIONS[idx - 1].id;
      this.validationMessage = null;
      this.render();
      this.scrollToTop();
    }
  };

  private setAnswer(qid: string, value: string) {
    this.answers = { ...this.answers, [qid]: value };
    this.validationMessage = null;
    saveQuickDraft(this.answers);
    this.render();
    // Restore focus to the Next control after the full re-render.
    this.root.querySelector<HTMLButtonElement>('#a-next-btn')?.focus();
  }

  private handleContactSubmit = async (form: HTMLFormElement) => {
    if (this.isSubmitting) return; // duplicate-submit protection
    const data = new FormData(form);
    const consent = data.get('consent');
    if (!consent) {
      this.validationMessage = 'Please acknowledge the consent statement to continue.';
      this.render();
      return;
    }
    const contact: QuickContactInfo = {
      firstName: String(data.get('firstName') || '').trim(),
      lastName: String(data.get('lastName') || '').trim(),
      email: String(data.get('email') || '').trim(),
      phone: String(data.get('phone') || '').trim() || undefined,
      company: String(data.get('company') || '').trim() || undefined,
      website: String(data.get('website') || '').trim() || undefined,
      marketingOptIn: Boolean(data.get('marketingOptIn')),
    };
    const contactError = validateQuickContact(contact);
    if (contactError) {
      this.validationMessage = contactError;
      this.render();
      return;
    }

    this.isSubmitting = true;
    this.state = 'submitting';
    this.render();

    const result = runQuickScore(this.answers);
    saveQuickContact(contact);
    saveQuickResult(JSON.stringify(result));

    (window as any).dataLayer = (window as any).dataLayer || [];
    (window as any).dataLayer.push({
      event: ASSESSMENT_EVENTS.complete,
      ...buildAssessmentCompleteParams(ASSESSMENT_TYPE.free),
    });

    this.pendingContact = contact;
    this.pendingResult = result;
    await this.attemptLeadSubmission();
  };

  /** Attempt (or retry) delivering the already-calculated quick-score
   * lead without ever re-collecting contact info or re-scoring. Only
   * renders results after genuine confirmed delivery. */
  private attemptLeadSubmission = async () => {
    if (!this.pendingContact || !this.pendingResult) return; // defensive
    this.isSubmitting = true;
    this.state = 'submitting';
    this.render();

    const outcome = await submitQuickLead({
      contact: this.pendingContact,
      result: this.pendingResult,
      answers: this.answers,
      questions: QUICK_QUESTIONS,
    });

    this.isSubmitting = false;

    if (!outcome.delivered) {
      this.state = 'submit-error';
      this.render();
      return;
    }

    // Non-PII only: funnel identifiers, correlation ID, coarse score band.
    (window as any).dataLayer.push({
      event: ASSESSMENT_EVENTS.leadSubmit,
      ...buildAssessmentLeadSubmitParams(ASSESSMENT_TYPE.free, outcome.leadId, this.pendingResult.overallScore),
    });

    clearQuickDraft();
    this.state = 'results';
    this.render();
    this.scrollToTop();
  };

  // ---- Rendering ---------------------------------------------------------

  private render() {
    if (typeof document !== 'undefined') {
      // Same focus-mode treatment as the full engine's app.
      document.body.classList.toggle('assessment-active', this.state !== 'intro' && this.state !== 'results');
    }
    if (this.state === 'intro') return this.renderIntro();
    if (this.state === 'contact') return this.renderContact();
    if (this.state === 'submitting') return this.renderSubmitting();
    if (this.state === 'submit-error') return this.renderSubmitError();
    if (this.state === 'results') return this.renderResults();
    return this.renderQuestion();
  }

  private renderIntro() {
    this.root.innerHTML = `
      <div class="a-intro">
        <span class="a-eyebrow">Free AI Opportunity Assessment</span>
        <h1>Get Your AI Department Score.</h1>
        <p class="a-intro-copy">
          Answer 15 quick questions — about 3-4 minutes — and get your AI Department Score,
          your category breakdown, and your biggest AI opportunities.
        </p>
        <ul class="a-intro-facts">
          <li>Free — no cost to complete</li>
          <li>About 3-4 minutes — 15 questions</li>
          <li>Deterministic scoring — not a generic quiz</li>
        </ul>
        <button type="button" class="a-btn a-btn-primary a-btn-large" id="a-quick-start-btn">Get My Score</button>
        <p class="a-intro-legal">
          By starting, you agree to our <a href="/privacy/">Privacy Policy</a> and
          <a href="/terms/">Terms of Use</a>.
        </p>
      </div>
    `;
    this.root.querySelector('#a-start-btn')?.addEventListener('click', this.startQuiz);
  }

  private renderQuestion() {
    const q = this.currentQuestion;
    const idx = this.currentIndex;
    const total = QUICK_QUESTIONS.length;
    const answeredCount = QUICK_QUESTIONS.filter((item) => this.isAnswered(item.id)).length;
    const progressPct = Math.round((answeredCount / total) * 100);

    this.root.innerHTML = `
      <div class="a-shell">
        <div class="a-topbar">
          <div class="a-topbar-title">
            <span class="a-eyebrow">AI Department Score</span>
            <p class="a-topbar-sub">15 questions &bull; About 3-4 minutes &bull; No commitment</p>
          </div>
          <div class="a-topbar-progress">
            <span>Progress</span>
            <div class="a-progress-track"><div class="a-progress-fill" style="width:${progressPct}%"></div></div>
            <span>${progressPct}%</span>
          </div>
        </div>

        <main class="a-main">
          <div class="a-question-card">
            <div class="a-question-meta">
              <span class="a-question-count">Question ${idx + 1} of ${total}</span>
            </div>
            <h2 class="a-question-prompt">${escapeHtml(q.prompt)}</h2>
            ${q.helpText ? `<p class="a-question-help">${escapeHtml(q.helpText)}</p>` : ''}
            ${this.validationMessage ? `<p class="a-error" role="alert">${escapeHtml(this.validationMessage)}</p>` : ''}
            <div class="a-answer-area">${this.renderAnswerControl(q.id)}</div>
          </div>

          <div class="a-nav-controls">
            <button type="button" class="a-btn a-btn-secondary" id="a-prev-btn" ${idx === 0 ? 'disabled' : ''}>&larr; Previous</button>
            <button type="button" class="a-btn a-btn-primary" id="a-next-btn">${idx === total - 1 ? 'Get My Score' : 'Next Question'} &rarr;</button>
          </div>
        </main>
      </div>
    `;

    this.attachHandlers(q.id);
    this.root.querySelector('#a-prev-btn')?.addEventListener('click', this.goPrevious);
    this.root.querySelector('#a-next-btn')?.addEventListener('click', this.goNext);
  }

  /** Renders one of the three control styles: the grouped industry
   * select (QS1), a native select for the 8 employee bands (QS2), and
   * the standard radio grid otherwise. All answer values remain plain
   * option labels — identical storage and scoring. */
  private renderAnswerControl(qid: string): string {
    const q = this.currentQuestion;
    const selected = typeof this.answers[qid] === 'string' ? (this.answers[qid] as string) : '';

    if (qid === 'QS1') {
      const groups = new Map<string, typeof q.options>();
      q.options.forEach((opt) => {
        const groupName = opt.group ?? 'Other';
        if (!groups.has(groupName)) groups.set(groupName, []);
        groups.get(groupName)!.push(opt);
      });
      const optionsHtml = Array.from(groups.entries())
        .map(([groupName, opts]) => {
          const optsHtml = opts
            .map((opt) => `<option value="${escapeHtml(opt.label)}" ${selected === opt.label ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`)
            .join('');
          return `<optgroup label="${escapeHtml(groupName)}">${optsHtml}</optgroup>`;
        })
        .join('');
      return `
        <div class="a-select-wrap">
          <select id="a-grouped-select-${qid}" data-grouped-select="${qid}" aria-label="${escapeHtml(q.prompt)}">
            <option value="" ${selected ? '' : 'selected'} disabled>Select your industry&hellip;</option>
            ${optionsHtml}
          </select>
        </div>
      `;
    }

    if (qid === 'QS2') {
      const optionsHtml = q.options
        .map((opt) => `<option value="${escapeHtml(opt.label)}" ${selected === opt.label ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`)
        .join('');
      return `
        <div class="a-select-wrap">
          <select id="a-grouped-select-${qid}" data-grouped-select="${qid}" aria-label="${escapeHtml(q.prompt)}">
            <option value="" ${selected ? '' : 'selected'} disabled>Select an option&hellip;</option>
            ${optionsHtml}
          </select>
        </div>
      `;
    }

    return (
      `<div class="a-options" role="radiogroup">` +
      q.options
        .map((opt) => {
          const isChecked = selected === opt.label;
          return `
            <label class="a-option${isChecked ? ' is-selected' : ''}">
              <input type="radio" name="a-single-${qid}" value="${escapeHtml(opt.label)}" ${isChecked ? 'checked' : ''} data-single="${qid}" />
              <span class="a-option-label">${escapeHtml(opt.label)}</span>
            </label>
          `;
        })
        .join('') +
      `</div>`
    );
  }

  private attachHandlers(qid: string) {
    this.root.querySelectorAll<HTMLInputElement>(`input[data-single="${qid}"]`).forEach((el) => {
      el.addEventListener('change', () => this.setAnswer(qid, el.value));
    });
    const groupedSelect = this.root.querySelector<HTMLSelectElement>(`select[data-grouped-select="${qid}"]`);
    groupedSelect?.addEventListener('change', () => this.setAnswer(qid, groupedSelect.value));
  }

  private renderSubmitting() {
    this.root.innerHTML = `<div class="a-submitting"><div class="a-spinner" aria-hidden="true"></div><p>Calculating your score&hellip;</p></div>`;
  }

  private renderContact() {
    const msg = this.validationMessage;
    this.root.innerHTML = `
      <div class="a-contact">
        <span class="a-eyebrow">Your AI Department Score is Ready</span>
        <h2>Enter your business information to see your score, category breakdown, and biggest AI opportunities.</h2>
        ${msg ? `<p class="a-error" role="alert">${escapeHtml(msg)}</p>` : ''}
        <form id="a-contact-form" novalidate>
          <div class="a-field-row">
            <label class="a-field"><span>First Name *</span><input type="text" name="firstName" required autocomplete="given-name" /></label>
            <label class="a-field"><span>Last Name</span><input type="text" name="lastName" autocomplete="family-name" /></label>
          </div>
          <label class="a-field"><span>Business Email *</span><input type="email" name="email" required autocomplete="email" /></label>
          <div class="a-field-row">
            <label class="a-field"><span>Company *</span><input type="text" name="company" required autocomplete="organization" /></label>
            <label class="a-field"><span>Phone</span><input type="tel" name="phone" autocomplete="tel" /></label>
          </div>
          <label class="a-field"><span>Website</span><input type="url" name="website" placeholder="https://" /></label>

          <label class="a-checkbox">
            <input type="checkbox" name="consent" required />
            <span>By submitting this assessment, you agree that Your AI Department may process the information you provide to generate your assessment results and respond to your inquiry. See our <a href="/privacy/">Privacy Policy</a> and <a href="/terms/">Terms of Use</a>.</span>
          </label>
          <label class="a-checkbox">
            <input type="checkbox" name="marketingOptIn" />
            <span>I'd also like to receive AI growth insights, guides, and occasional updates.</span>
          </label>

          <button type="submit" class="a-btn a-btn-primary a-btn-large">Show My AI Department Score</button>
        </form>
      </div>
    `;
    const form = this.root.querySelector<HTMLFormElement>('#a-contact-form');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleContactSubmit(form);
    });
  }

  private renderSubmitError() {
    this.root.innerHTML = `
      <div class="a-contact">
        <span class="a-eyebrow">Your AI Department Score is Ready</span>
        <h2>We couldn't deliver your results just now.</h2>
        <p class="a-error" role="alert">Your completed score is saved — nothing has been lost. This is usually a temporary connection issue. Please try again, or email us directly at <a href="mailto:michael@youraidepartment.ai">michael@youraidepartment.ai</a> if this keeps happening.</p>
        <button type="button" class="a-btn a-btn-primary a-btn-large" id="a-retry-btn">Try Again</button>
      </div>
    `;
    const retryBtn = this.root.querySelector<HTMLButtonElement>('#a-retry-btn');
    retryBtn?.addEventListener('click', () => {
      if (retryBtn.disabled) return; // duplicate-submit protection during retry
      retryBtn.disabled = true;
      this.attemptLeadSubmission();
    });
  }

  private renderResults() {
    const result = this.pendingResult;
    if (!result) {
      this.state = 'intro';
      return this.renderIntro();
    }
    const isEnterprise = result.enterpriseCandidate;
    const topSignals = result.signals.slice(0, 3);
    const bookingUrl = isEnterprise ? SCHEDULING.enterpriseDiscussion.url : SCHEDULING.strategyCall.url;

    this.root.innerHTML = `
      <div class="q-results">
        <div class="r-score-panel">
          <div class="r-score-ring">
            <div class="r-score-number">${result.overallScore}</div>
            <div class="r-score-max">/ 100</div>
          </div>
          <div class="r-score-detail">
            <p class="r-stage">${escapeHtml(result.stage)}</p>
            <p class="r-stage-note">Your AI Department Score reflects your company's current AI readiness across seven business areas.</p>
          </div>
        </div>

        <div class="r-categories">
          <h2>Category Scores</h2>
          <ul>
            ${result.categories
              .map(
                (c) => `
                <li>
                  <div class="r-cat-row"><span>${escapeHtml(c.label)}</span><span>${c.scorePercent}</span></div>
                  <div class="r-cat-track"><div class="r-cat-fill" style="width:${c.scorePercent}%"></div></div>
                </li>
              `
              )
              .join('')}
          </ul>
        </div>

        ${
          topSignals.length > 0
            ? `
        <div class="r-recommendations">
          <h2>Your Biggest AI Opportunities</h2>
          ${topSignals
            .map(
              (s) => `
            <div class="r-rec-card">
              <h3>${escapeHtml(s.title)}</h3>
              <p>${escapeHtml(s.finding)}</p>
              <p class="r-rec-action"><strong>Recommended action:</strong> ${escapeHtml(s.action)}</p>
              <p class="r-rec-service"><a href="${s.serviceHref}">Learn more: ${escapeHtml(s.serviceLabel)} &rarr;</a></p>
            </div>
          `
            )
            .join('')}
        </div>`
            : `<p class="q-no-signals">Your answers show a mature AI foundation. A strategy conversation can help identify what to scale next.</p>`
        }

        <div class="q-upgrade">
          <div class="q-upgrade-card">
            <span class="q-upgrade-tag">Deeper Diagnosis</span>
            <h2>Comprehensive AI Business Audit — $495</h2>
            <p>Want a deeper look at your AI readiness, marketing and lead flow, sales follow-up, customer communication, operational automation, and AI agents and integrations? Request the Comprehensive AI Business Audit and receive a personalized audit report, prioritized AI opportunities, financial-impact scenarios where your data supports them, and a 45-minute strategy review call.</p>
            <a class="r-btn r-btn-primary" href="/comprehensive-ai-business-audit/">Request the $495 Audit</a>
          </div>
        </div>

        <div class="r-cta">
          <h2>${isEnterprise ? 'Discuss an Enterprise Engagement' : 'Ready to Discuss Your Opportunities?'}</h2>
          <p>${isEnterprise ? 'Given the size of your organization, an enterprise conversation is the appropriate next step to explore AI opportunities in depth.' : 'Schedule a free strategy call to review your results and discuss what to prioritize first.'}</p>
          <a class="r-btn r-btn-primary" href="${bookingUrl}">${isEnterprise ? 'Discuss an Enterprise Engagement' : 'Schedule a Strategy Call'}</a>
        </div>

        <p class="r-disclaimer">This score provides an initial diagnostic based on your responses. It does not replace a full executive discovery process. Assessment version: ${QUICK_ASSESSMENT_VERSION}.</p>
      </div>
    `;
  }
}

export function mountQuickAssessmentApp(root: HTMLElement): QuickAssessmentApp {
  return new QuickAssessmentApp(root);
}
