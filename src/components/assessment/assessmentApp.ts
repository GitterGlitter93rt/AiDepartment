// Client-side AI Department Assessment engine.
// Vanilla TypeScript, no framework — question data drives rendering so no
// per-question UI components exist. See docs/04-assessment/implementation-spec.md
// "IMPLEMENTATION DATA MODEL": "one reusable question engine."

import { getVisibleQuestions, QUESTIONS } from '../../data/assessment/questions';
import { SECTIONS, getSectionMeta } from '../../data/assessment/sections';
import type { AnswerMap, QuestionDef, FullAssessmentResult } from '../../data/assessment/types';
import { runAssessment } from '../../lib/assessment/runAssessment';
import { calculatePublicScoreShell } from '../../lib/assessment/calculatePublicScore';
import { saveDraft, loadDraft, clearDraft, saveResult, saveContact, type ContactInfo } from '../../lib/assessment/persistence';
import { submitAssessmentLead, buildLeadAnalyticsFields, validateContact } from '../../lib/assessment/leadSubmission';

type ViewState = 'intro' | 'question' | 'contact' | 'submitting' | 'submit-error';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class AssessmentApp {
  private root: HTMLElement;
  private answers: AnswerMap = {};
  private currentId: string;
  private state: ViewState = 'intro';
  private validationMessage: string | null = null;
  // Preserved across a failed submission so retry doesn't require
  // re-entering contact info or re-answering questions — the assessment
  // is never lost on a network failure.
  private pendingContact: ContactInfo | null = null;
  private pendingResult: FullAssessmentResult | null = null;
  private isSubmitting = false;

  constructor(root: HTMLElement) {
    this.root = root;
    const draft = loadDraft();
    if (draft) this.answers = draft;
    const visible = getVisibleQuestions(this.answers);
    // Resume at the first unanswered question so a refresh genuinely
    // continues progress rather than sending the user back to Q1 with
    // their answers merely pre-filled.
    const firstUnanswered = visible.find((q) => !this.isAnswered(q));
    this.currentId = firstUnanswered?.id ?? visible[visible.length - 1]?.id ?? QUESTIONS[0].id;
    this.render();
  }

  private get visibleQuestions(): QuestionDef[] {
    return getVisibleQuestions(this.answers);
  }

  private get currentIndex(): number {
    const idx = this.visibleQuestions.findIndex((q) => q.id === this.currentId);
    return idx < 0 ? 0 : idx;
  }

  private get currentQuestion(): QuestionDef {
    const visible = this.visibleQuestions;
    return visible[this.currentIndex] ?? visible[0];
  }

  private isAnswered(q: QuestionDef): boolean {
    const val = this.answers[q.id];
    if (q.type === 'multi') return Array.isArray(val) && val.length > 0;
    if (q.type === 'text') return typeof val === 'string' && val.trim().length > 0;
    return typeof val === 'string' && val.length > 0;
  }

  private canAdvance(): boolean {
    const q = this.currentQuestion;
    if (!q.required) return true;
    return this.isAnswered(q);
  }

  private goNext = () => {
    if (!this.canAdvance()) {
      this.validationMessage = 'Please answer this question to continue.';
      this.render();
      return;
    }
    this.validationMessage = null;
    saveDraft(this.answers);
    const visible = this.visibleQuestions;
    const idx = this.currentIndex;
    if (idx < visible.length - 1) {
      this.currentId = visible[idx + 1].id;
      this.render();
    } else {
      this.state = 'contact';
      this.render();
    }
    this.scrollToTop();
  };

  private goPrevious = () => {
    const visible = this.visibleQuestions;
    const idx = this.currentIndex;
    if (idx > 0) {
      this.currentId = visible[idx - 1].id;
      this.validationMessage = null;
      this.render();
      this.scrollToTop();
    }
  };

  private goToSection = (sectionId: string) => {
    const visible = this.visibleQuestions;
    const firstInSection = visible.find((q) => q.section === sectionId);
    if (firstInSection) {
      this.currentId = firstInSection.id;
      this.validationMessage = null;
      this.render();
      this.scrollToTop();
    }
  };

  private scrollToTop() {
    this.root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private setSingleAnswer(qid: string, value: string) {
    this.answers = { ...this.answers, [qid]: value };
    this.validationMessage = null;
    saveDraft(this.answers);
    this.render();
    // Full re-render replaces the DOM, so the just-clicked radio (and any
    // keyboard focus on it) is destroyed. For single-select, the natural
    // next action is advancing, so restore focus there rather than
    // silently dropping it to <body>.
    this.root.querySelector<HTMLButtonElement>('#a-next-btn')?.focus();
  }

  private toggleMultiAnswer(qid: string, value: string, max?: number) {
    const current = Array.isArray(this.answers[qid]) ? [...(this.answers[qid] as string[])] : [];
    const exists = current.includes(value);
    let next: string[];
    if (exists) {
      next = current.filter((v) => v !== value);
    } else {
      if (max && current.length >= max) {
        this.validationMessage = `You can select up to ${max}.`;
        this.render();
        this.root.querySelector<HTMLInputElement>(`input[data-multi="${qid}"][value="${CSS.escape(value)}"]`)?.focus();
        return;
      }
      next = [...current, value];
    }
    this.answers = { ...this.answers, [qid]: next };
    this.validationMessage = null;
    saveDraft(this.answers);
    this.render();
    // Unlike single-select, multi-select expects repeated interaction, so
    // restore focus to the same checkbox rather than moving to Next.
    this.root.querySelector<HTMLInputElement>(`input[data-multi="${qid}"][value="${CSS.escape(value)}"]`)?.focus();
  }

  private setTextAnswer(qid: string, value: string) {
    this.answers = { ...this.answers, [qid]: value };
    saveDraft(this.answers);
  }

  private startAssessment = () => {
    this.state = 'question';
    this.render();
  };

  private handleContactSubmit = async (form: HTMLFormElement) => {
    if (this.isSubmitting) return; // duplicate-submit protection
    const data = new FormData(form);
    const consent = data.get('consent');
    if (!consent) {
      this.validationMessage = 'Please acknowledge the consent statement to continue.';
      this.render();
      return;
    }
    const contact: ContactInfo = {
      firstName: String(data.get('firstName') || '').trim(),
      lastName: String(data.get('lastName') || '').trim(),
      email: String(data.get('email') || '').trim(),
      phone: String(data.get('phone') || '').trim() || undefined,
      company: String(data.get('company') || '').trim() || undefined,
      website: String(data.get('website') || '').trim() || undefined,
      marketingOptIn: Boolean(data.get('marketingOptIn')),
    };
    const contactError = validateContact(contact);
    if (contactError) {
      this.validationMessage = contactError;
      this.render();
      return;
    }

    this.isSubmitting = true;
    this.state = 'submitting';
    this.render();

    const result = runAssessment(this.answers);
    // Persist only the public-safe projection. `result.commercial` is
    // computed for internal use and must never be written to client-side
    // storage, since anything in localStorage is trivially inspectable.
    const publicSafeResult = {
      assessmentVersion: result.assessmentVersion,
      completedAt: result.completedAt,
      public: result.public,
      roi: result.roi,
      flags: result.flags,
    };
    saveContact(contact);
    saveResult(JSON.stringify(publicSafeResult));

    // Fires here — the moment all questions are answered and the result
    // has actually been calculated — independent of whether lead
    // delivery below succeeds or fails. This matches the event's
    // intended semantic ("assessment completed") rather than tying it
    // to a later, separate concern (successful lead delivery, which is
    // ai_assessment_lead_submit's job).
    (window as any).dataLayer = (window as any).dataLayer || [];
    (window as any).dataLayer.push({ event: 'ai_assessment_complete' });

    this.pendingContact = contact;
    this.pendingResult = result;
    await this.attemptLeadSubmission();
  };

  /** Attempt (or retry) delivering the already-calculated assessment
   * lead. Never re-collects contact info or re-runs the assessment —
   * both are already stored on the instance from the original
   * successful validation. Only reveals results after Web3Forms
   * confirms genuine delivery; on failure, shows a retry state without
   * losing anything already calculated. */
  private attemptLeadSubmission = async () => {
    if (!this.pendingContact || !this.pendingResult) return; // defensive; should be unreachable
    this.isSubmitting = true;
    this.state = 'submitting';
    this.render();

    const outcome = await submitAssessmentLead({
      contact: this.pendingContact,
      result: this.pendingResult,
      answers: this.answers,
      questions: QUESTIONS,
    });

    this.isSubmitting = false;

    if (!outcome.delivered) {
      this.state = 'submit-error';
      this.render();
      return;
    }

    // Fires only after genuine, confirmed Web3Forms delivery — never on
    // a failed or merely-attempted submission. Non-PII only: a lead
    // correlation ID, the assessment version, and a coarse score band —
    // never contact fields, never the full result, never raw answers.
    (window as any).dataLayer.push({
      event: 'ai_assessment_lead_submit',
      ...buildLeadAnalyticsFields(outcome.leadId, this.pendingResult),
    });

    clearDraft();
    window.location.href = '/ai-assessment/results/';
  };

  // ---- Rendering ---------------------------------------------------------

  private render() {
    if (typeof document !== 'undefined') {
      // Hide the full marketing footer during the active question flow so the
      // assessment feels like a focused application. The intro screen keeps
      // normal site chrome since it's still effectively a landing page.
      document.body.classList.toggle('assessment-active', this.state !== 'intro');
    }
    if (this.state === 'intro') return this.renderIntro();
    if (this.state === 'contact') return this.renderContact();
    if (this.state === 'submitting') return this.renderSubmitting();
    if (this.state === 'submit-error') return this.renderSubmitError();
    return this.renderQuestion();
  }

  private renderIntro() {
    this.root.innerHTML = `
      <div class="a-intro">
        <span class="a-eyebrow">AI Department Assessment</span>
        <h1>Find Out Where AI Can Actually Improve Your Business.</h1>
        <p class="a-intro-copy">
          In approximately 7-12 minutes, this assessment evaluates key areas of your business
          and produces your AI Department Score with personalized opportunity recommendations.
        </p>
        <ul class="a-intro-facts">
          <li>Free — no cost to complete</li>
          <li>7-12 minutes for most companies</li>
          <li>Deterministic scoring — not a generic quiz</li>
        </ul>
        <button type="button" class="a-btn a-btn-primary a-btn-large" id="a-start-btn">Start Assessment</button>
        <p class="a-intro-legal">
          By starting, you agree to our <a href="/privacy/">Privacy Policy</a> and
          <a href="/terms/">Terms of Use</a>.
        </p>
      </div>
    `;
    this.root.querySelector('#a-start-btn')?.addEventListener('click', this.startAssessment);
  }

  private renderSubmitting() {
    this.root.innerHTML = `<div class="a-submitting"><div class="a-spinner" aria-hidden="true"></div><p>Calculating your results&hellip;</p></div>`;
  }

  private renderContact() {
    const msg = this.validationMessage;
    this.root.innerHTML = `
      <div class="a-contact">
        <span class="a-eyebrow">Your AI Department Score is Ready</span>
        <h2>Enter your business information to view your overall score, category scores, biggest AI opportunities, and recommended next steps.</h2>
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
        <p class="a-error" role="alert">Your completed assessment is saved — nothing has been lost. This is usually a temporary connection issue. Please try again, or email us directly at <a href="mailto:michael@youraidepartment.ai">michael@youraidepartment.ai</a> if this keeps happening.</p>
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

  private renderQuestion() {
    const q = this.currentQuestion;
    const visible = this.visibleQuestions;
    const idx = this.currentIndex;
    const total = visible.length;
    const answeredCount = visible.filter((vq) => this.isAnswered(vq)).length;
    const progressPct = Math.round((answeredCount / total) * 100);
    const sectionMeta = getSectionMeta(q.section);

    const scoreShell = calculatePublicScoreShell(this.answers);

    this.root.innerHTML = `
      <div class="a-shell">
        <div class="a-topbar">
          <div class="a-topbar-title">
            <span class="a-eyebrow">AI Department Assessment</span>
            <p class="a-topbar-sub">7-12 minutes &bull; No commitment &bull; Results in minutes</p>
          </div>
          <div class="a-topbar-progress">
            <span>Overall Progress</span>
            <div class="a-progress-track"><div class="a-progress-fill" style="width:${progressPct}%"></div></div>
            <span>${progressPct}% Complete</span>
            <span class="a-progress-hint">Total may change based on your answers.</span>
          </div>
        </div>

        <div class="a-body">
          <nav class="a-sidebar" aria-label="Assessment sections">
            ${this.renderSectionNav(visible)}
          </nav>

          <main class="a-main">
            <div class="a-question-card">
              <div class="a-question-meta">
                <span class="a-section-tag">${escapeHtml(sectionMeta.navLabel)}</span>
                <span class="a-question-count">Question ${idx + 1} of ${total}</span>
              </div>
              <h2 class="a-question-prompt">${escapeHtml(q.prompt)}</h2>
              ${q.helpText ? `<p class="a-question-help">${escapeHtml(q.helpText)}</p>` : ''}
              ${this.validationMessage ? `<p class="a-error" role="alert">${escapeHtml(this.validationMessage)}</p>` : ''}
              <div class="a-answer-area">${this.renderAnswerControl(q)}</div>
            </div>

            <div class="a-nav-controls">
              <button type="button" class="a-btn a-btn-secondary" id="a-prev-btn" ${idx === 0 ? 'disabled' : ''}>&larr; Previous</button>
              <button type="button" class="a-btn a-btn-primary" id="a-next-btn">${idx === total - 1 ? 'See My Results' : 'Next Question'} &rarr;</button>
            </div>
          </main>

          <aside class="a-scorebar" aria-label="Score preview">
            <h3>Your Score Preview</h3>
            <div class="a-score-ring-wrap">
              <div class="a-score-number">${scoreShell.overallScore}</div>
              <div class="a-score-stage">${escapeHtml(scoreShell.stage)}</div>
            </div>
            <ul class="a-score-categories">
              ${scoreShell.categories
                .map(
                  (c) => `<li><span class="a-dot"></span><span class="a-cat-label">${escapeHtml(c.label)}</span><span class="a-cat-val">${c.answeredCount > 0 ? c.scorePercent : '\u2013'}</span></li>`
                )
                .join('')}
            </ul>
            <p class="a-scorebar-note">Complete all sections to see your full AI Department Score and personalized recommendations.</p>
            <div class="a-trust-note">
              <strong>Your information is secure and confidential.</strong>
              <span>We use your answers only to generate your results and recommendations.</span>
            </div>
          </aside>
        </div>
      </div>
    `;

    this.attachQuestionHandlers(q);
    this.root.querySelector('#a-prev-btn')?.addEventListener('click', this.goPrevious);
    this.root.querySelector('#a-next-btn')?.addEventListener('click', this.goNext);
    this.root.querySelectorAll<HTMLElement>('.a-section-nav-item[data-section]').forEach((el) => {
      el.addEventListener('click', () => this.goToSection(el.dataset.section!));
    });
  }

  private renderSectionNav(visible: QuestionDef[]): string {
    const sectionsPresent = SECTIONS.filter((s) => visible.some((q) => q.section === s.id));
    return sectionsPresent
      .map((s) => {
        const qsInSection = visible.filter((q) => q.section === s.id);
        const answered = qsInSection.filter((q) => this.isAnswered(q)).length;
        const isCurrent = this.currentQuestion.section === s.id;
        return `
          <button type="button" class="a-section-nav-item${isCurrent ? ' is-active' : ''}" data-section="${s.id}">
            <span class="a-section-nav-label">${escapeHtml(s.navLabel)}</span>
            <span class="a-section-nav-sub">${escapeHtml(s.navSubtitle)}</span>
            <span class="a-section-nav-count">${answered}/${qsInSection.length}</span>
          </button>
        `;
      })
      .join('');
  }

  private renderAnswerControl(q: QuestionDef): string {
    if (q.type === 'text') {
      const val = typeof this.answers[q.id] === 'string' ? (this.answers[q.id] as string) : '';
      return `<textarea id="a-text-input" maxlength="${q.maxLength ?? 600}" rows="4" placeholder="Type your answer (optional)&hellip;">${escapeHtml(val)}</textarea>`;
    }

    // Q1 (industry) uses a grouped native <select> instead of the normal
    // single-select radio grid — with 28+ industries, a flat radio list
    // would be unusably long. The answer is still a plain string label
    // stored via setSingleAnswer, identical to every other single-select
    // question — scoring, validation, and branching are untouched.
    if (q.id === 'Q1' && q.type === 'single') {
      const selected = typeof this.answers[q.id] === 'string' ? this.answers[q.id] : '';
      const groups = new Map<string, typeof q.options>();
      (q.options ?? []).forEach((opt) => {
        const groupName = opt.group ?? 'Other';
        if (!groups.has(groupName)) groups.set(groupName, []);
        groups.get(groupName)!.push(opt);
      });
      const optionsHtml = Array.from(groups.entries())
        .map(([groupName, opts]) => {
          const optsHtml = (opts ?? [])
            .map((opt) => `<option value="${escapeHtml(opt.label)}" ${selected === opt.label ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`)
            .join('');
          return `<optgroup label="${escapeHtml(groupName)}">${optsHtml}</optgroup>`;
        })
        .join('');
      return `
        <div class="a-select-wrap">
          <select id="a-grouped-select-${q.id}" data-grouped-select="${q.id}" aria-label="${escapeHtml(q.prompt)}">
            <option value="" ${selected ? '' : 'selected'} disabled>Select your industry&hellip;</option>
            ${optionsHtml}
          </select>
        </div>
      `;
    }

    if (q.type === 'multi') {
      const selected = Array.isArray(this.answers[q.id]) ? (this.answers[q.id] as string[]) : [];
      const maxNote = q.maxSelections ? `<p class="a-max-note">Select up to ${q.maxSelections}.</p>` : '';
      return (
        maxNote +
        `<div class="a-options" role="group">` +
        (q.options ?? [])
          .map((opt) => {
            const isChecked = selected.includes(opt.label);
            return `
              <label class="a-option${isChecked ? ' is-selected' : ''}">
                <input type="checkbox" value="${escapeHtml(opt.label)}" ${isChecked ? 'checked' : ''} data-multi="${q.id}" />
                <span class="a-option-label">${escapeHtml(opt.label)}</span>
              </label>
            `;
          })
          .join('') +
        `</div>`
      );
    }

    // single select
    const selected = typeof this.answers[q.id] === 'string' ? this.answers[q.id] : undefined;
    return (
      `<div class="a-options" role="radiogroup">` +
      (q.options ?? [])
        .map((opt) => {
          const isChecked = selected === opt.label;
          return `
            <label class="a-option${isChecked ? ' is-selected' : ''}">
              <input type="radio" name="a-single-${q.id}" value="${escapeHtml(opt.label)}" ${isChecked ? 'checked' : ''} data-single="${q.id}" />
              <span class="a-option-label">${escapeHtml(opt.label)}</span>
            </label>
          `;
        })
        .join('') +
      `</div>`
    );
  }

  private attachQuestionHandlers(q: QuestionDef) {
    this.root.querySelectorAll<HTMLInputElement>('input[data-single]').forEach((el) => {
      el.addEventListener('change', () => this.setSingleAnswer(q.id, el.value));
    });
    this.root.querySelectorAll<HTMLInputElement>('input[data-multi]').forEach((el) => {
      el.addEventListener('change', () => this.toggleMultiAnswer(q.id, el.value, q.maxSelections));
    });
    const groupedSelect = this.root.querySelector<HTMLSelectElement>(`select[data-grouped-select="${q.id}"]`);
    groupedSelect?.addEventListener('change', () => this.setSingleAnswer(q.id, groupedSelect.value));
    const textarea = this.root.querySelector<HTMLTextAreaElement>('#a-text-input');
    textarea?.addEventListener('input', () => this.setTextAnswer(q.id, textarea.value));
  }
}

export function mountAssessmentApp(root: HTMLElement): AssessmentApp {
  return new AssessmentApp(root);
}
