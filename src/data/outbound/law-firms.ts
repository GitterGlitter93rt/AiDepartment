// Cold-email outbound landing page — law firms.
// Route: /go/law-firms/  (noindex, follow — see seo.robots below)
//
// AUDIENCE: an attorney or firm administrator who did not ask to hear
// from us. They are being interrupted, they have been pitched "AI" more
// than once this year, and the two things most likely to lose them are
// a page that implies AI practises law and a page that asks them to
// fill in a questionnaire before a human has said anything.
//
// So: the strategy call is the ask, the assessment is a quiet second
// option, and the boundaries section is not a disclaimer — it is part of
// the argument.
//
// CONTENT GUARDRAILS (enforced by tests/outboundLanding.test.ts):
//   - no case values, settlement figures, conversion rates, or ROI
//   - no client names, testimonials, or case studies
//   - no price
//   - nothing that suggests AI performs legal work or replaces staff

import { SCHEDULING } from '../../lib/scheduling.ts';
import type { OutboundConfig } from '../../lib/outbound/types.ts';

const CTA_LABEL = 'Schedule a Free 30-Minute AI Strategy Call';
const CTA_MICRO = 'No preparation, no software to install, no obligation.';

export const lawFirmsOutbound: OutboundConfig = {
  slug: 'law-firms',
  path: '/go/law-firms/',
  audience: 'law_firms',
  campaignId: 'law_firms_outbound',
  contentPrefix: 'law_e',

  seo: {
    title: 'AI Systems for Law Firms | Your AI Department',
    description:
      'Practical AI systems that help firms answer faster, collect intake information, schedule consultations, and keep follow-up moving — working with the systems the firm already uses.',
    // Overlaps /industries/law-firms/ by design. Out of the index so
    // the two never compete for the same query; "follow" so its
    // internal links still pass equity.
    robots: 'noindex, follow',
  },

  hero: {
    eyebrow: 'AI Systems for Law Firms',
    headline: 'Stop Letting Valuable Legal Leads',
    headlineLine2: 'Go Cold',
    subhead:
      'Your AI Department builds practical AI systems that help firms answer faster, collect intake information, schedule consultations, automate follow-up, and connect lead activity to the systems the firm already uses.',
    bullets: [
      'Works with your existing phone, intake, and case management systems',
      'Human judgment stays with your team',
      'Built around how your firm actually intakes a matter',
    ],
    cta: {
      label: CTA_LABEL,
      compactLabel: 'Book My Strategy Call',
      href: SCHEDULING.strategyCall.url,
      type: 'strategy_call',
      microcopy: CTA_MICRO,
    },
    secondaryCta: {
      label: 'Or see your AI opportunities first',
      href: '/free-ai-assessment/',
      type: 'assessment',
      microcopy: 'Free assessment, about 3–4 minutes.',
    },
  },

  flow: {
    eyebrow: 'The Path a Matter Takes',
    heading: 'Every Handoff Between the Call and the Consultation Is a Place to Lose It',
    intro:
      'A potential client rarely contacts one firm. The firm that answers, captures the details, and gets a time on the calendar is usually the firm that keeps the conversation.',
    steps: [
      { label: 'Lead Arrives', icon: 'inbox' },
      { label: 'Immediate Response', icon: 'zap' },
      { label: 'Intake Information Collected', icon: 'clipboard-list' },
      { label: 'Consultation Scheduled', icon: 'calendar-clock' },
      { label: 'Case System Updated', icon: 'database' },
      { label: 'Follow-Up Tracked', icon: 'repeat' },
    ],
    note: 'The chain is the product. Any one link left manual is where matters quietly stall.',
  },

  capabilities: {
    eyebrow: 'Where the Work Goes',
    heading: 'Six Places Firms Commonly Lose Time and Leads',
    intro:
      'These are the areas we look at first. Which ones matter for your firm depends entirely on how you already work — that is what the call is for.',
    items: [
      {
        icon: 'phone-missed',
        title: 'Missed and After-Hours Calls',
        body:
          'A caller who reaches voicemail at 6pm is a caller deciding whether to try the next firm. AI-assisted answering can take the call, capture who they are and what happened, and hand a complete summary to your team.',
      },
      {
        icon: 'clipboard-list',
        title: 'Lead Intake',
        body:
          'The same questions get asked on every first call. Collecting that structured information consistently — regardless of who picks up, or whether anyone does — means your team starts from a full picture rather than a name and a number.',
      },
      {
        icon: 'calendar-clock',
        title: 'Consultation Scheduling',
        body:
          'Getting a consultation on the calendar while the person is still engaged, instead of through a round of callbacks that can take days and often ends in silence.',
      },
      {
        icon: 'database',
        title: 'CRM and Case Management Entry',
        body:
          'Conversation details reaching your existing case management or CRM record automatically, so nobody is re-keying an intake form into a system after hours.',
      },
      {
        icon: 'repeat',
        title: 'Follow-Up',
        body:
          'Consultations that were never confirmed, prospects who went quiet, documents that were requested but never arrived — sequences that keep working without anyone remembering to run them.',
      },
      {
        icon: 'bar-chart-3',
        title: 'Marketing Attribution',
        body:
          'Connecting the ad, search, or referral that produced an inquiry to what the inquiry actually became — so marketing decisions are made on signed matters, not on form fills.',
      },
    ],
  },

  boundaries: {
    eyebrow: 'What This Is Not',
    heading: 'AI Handles Repetitive Handoffs, Not the Practice of Law',
    items: [
      {
        title: 'We work with your existing systems',
        body:
          'This is a connective layer over the phone system, intake process, and case management software your firm already uses. Replacing them is a separate conversation, and usually the wrong one.',
      },
      {
        title: 'Human judgment stays with your team',
        body:
          'Nothing here gives legal advice, evaluates a matter, or decides whether to take a case. Those are attorney decisions and they stay attorney decisions.',
      },
      {
        title: 'Nobody gets replaced by a script',
        body:
          'The goal is that your intake staff spend their time on conversations that need a person, instead of re-typing information and chasing callbacks. Capacity, not headcount reduction.',
      },
      {
        title: 'Everything stays reviewable',
        body:
          'Every AI-assisted summary or record update should be traceable to the conversation it came from, so your team can check it, correct it, or reverse it.',
      },
    ],
  },

  call: {
    eyebrow: 'The Call',
    heading: 'Thirty Minutes, About Your Firm',
    intro:
      'This is a working conversation about how matters currently reach your firm and where they stall — not a product demonstration.',
    items: [
      {
        icon: 'search',
        title: 'What happens now',
        body:
          'How inquiries reach the firm today, who handles them, what happens after hours, and where the process depends on someone remembering something.',
      },
      {
        icon: 'list-checks',
        title: 'Where automation actually fits',
        body:
          'Which of the six areas above would change anything for your firm, and — just as usefully — which ones would not be worth the effort.',
      },
      {
        icon: 'route',
        title: 'What a first build would involve',
        body:
          'A concrete sense of scope, sequencing, and what integrating with your current systems would require, so you can judge whether it is worth going further.',
      },
    ],
    faqs: [
      {
        question: 'Is this an AI chatbot on our website?',
        answer:
          'It can include one, but that is rarely where the value is. Most of what we look at sits around the phone, intake, scheduling, and case-system handoffs — the places where a lead is lost between a first contact and a scheduled consultation.',
      },
      {
        question: 'Will this work with the case management software we already use?',
        answer:
          'That is the assumption we start from. Integration approach depends on what your system supports — a direct API, a webhook, or an integration platform — and evaluating that honestly is part of the call. If a system genuinely cannot be integrated, we say so rather than proposing a workaround that creates a second place your data lives.',
      },
      {
        question: 'Are you going to tell us to replace our intake staff?',
        answer:
          'No. The firms that get value from this are usually the ones where intake staff are already stretched — the work goes to the repetitive handoffs so that people can spend their time on the conversations that need a person.',
      },
      {
        question: 'What about confidentiality and client information?',
        answer:
          'Any system handling potential-client information needs explicit decisions about what is collected, where it is stored, who can see it, and how long it is kept. Those decisions are part of the design, not an afterthought, and your firm makes them.',
      },
      {
        question: 'What does it cost?',
        answer:
          'It depends entirely on scope, and quoting a number before understanding how your firm works would be guessing. The call is free and carries no obligation; if there is a fit, you get a concrete scope and price afterwards.',
      },
    ],
    cta: {
      label: CTA_LABEL,
      compactLabel: 'Book My Strategy Call',
      href: SCHEDULING.strategyCall.url,
      type: 'strategy_call',
      microcopy: CTA_MICRO,
    },
  },

  close: {
    eyebrow: 'Next Step',
    heading: 'See What This Would Look Like for Your Firm',
    body:
      'Thirty minutes on how inquiries reach your firm today, where they stall, and which parts of that are worth automating. If the answer is "not much yet", that is a useful outcome too.',
    cta: {
      label: CTA_LABEL,
      compactLabel: 'Book My Strategy Call',
      href: SCHEDULING.strategyCall.url,
      type: 'strategy_call',
      microcopy: CTA_MICRO,
    },
    whatHappens: [
      'You pick a time that works — the calendar opens straight away.',
      'We ask about your current intake process before proposing anything.',
      'You leave with a clear view of what would and would not be worth building.',
    ],
  },
};
