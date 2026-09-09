// Cold-email outbound landing page — roofing.
// Route: /go/roofing/  (noindex, follow — see seo.robots below)
//
// AUDIENCE: a roofing owner or operations manager who did not ask to
// hear from us, is probably reading this on a phone, and has been sold
// leads, software, and "AI" by people who have never watched a storm
// week from the inside.
//
// The argument that lands is not "AI". It is that expensive leads
// disappear in the gap between the first phone call and a sales
// appointment, and that the gap is a systems problem. The argument that
// loses is any promise about booked jobs or revenue, because they have
// heard that before and it was not true.
//
// CONTENT GUARDRAILS (enforced by tests/outboundLanding.test.ts):
//   - no close rates, job values, revenue figures, or ROI
//   - no guarantee of booked jobs or appointments
//   - no client names, testimonials, or case studies
//   - no price
//   - nothing that suggests replacing crew or office staff

import { SCHEDULING } from '../../lib/scheduling.ts';
import type { OutboundConfig } from '../../lib/outbound/types.ts';

const CTA_LABEL = 'Schedule a Free 30-Minute AI Strategy Call';
const CTA_MICRO = 'No preparation, no software to install, no obligation.';

export const roofingOutbound: OutboundConfig = {
  slug: 'roofing',
  path: '/go/roofing/',
  audience: 'roofing',
  campaignId: 'roofing_outbound',
  contentPrefix: 'roof_e',

  seo: {
    title: 'AI Systems for Roofing Companies | Your AI Department',
    description:
      'Connect AI answering, lead response, scheduling, and follow-up to the CRM you already use, so expensive roofing leads stop disappearing between the first call and the appointment.',
    robots: 'noindex, follow',
  },

  hero: {
    eyebrow: 'AI Systems for Roofing Companies',
    headline: 'Turn More Roofing Leads',
    headlineLine2: 'Into Actual Appointments',
    subhead:
      'Your AI Department connects AI answering, lead response, scheduling, follow-up, and your existing CRM so expensive leads stop disappearing between the first phone call and the sales appointment.',
    bullets: [
      'Works with the CRM and phone system you already run',
      'Built to hold up when a storm triples your call volume',
      'Your crews and your office staff keep doing what they do',
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
    eyebrow: 'The Path a Lead Takes',
    heading: 'The Money Is Lost Between the Call and the Appointment',
    intro:
      'You already paid for the lead. What happens in the next few hours decides whether it becomes an inspection on the calendar or a number in a spreadsheet nobody calls back.',
    steps: [
      { label: 'Lead or Call Arrives', icon: 'phone-call' },
      { label: 'Immediate Response', icon: 'zap' },
      { label: 'Details Captured', icon: 'clipboard-list' },
      { label: 'Inspection Scheduled', icon: 'calendar-clock' },
      { label: 'CRM Updated', icon: 'database' },
      { label: 'Follow-Up Until It Closes', icon: 'repeat' },
    ],
    note: 'Any link left to "someone will get to it" is where the lead you paid for goes quiet.',
  },

  capabilities: {
    eyebrow: 'Where the Work Goes',
    heading: 'Six Places Roofing Companies Commonly Lose Leads',
    intro:
      'These are the areas we look at first. Which of them matter for your company depends on how you already run — that is what the call is for.',
    items: [
      {
        icon: 'phone-missed',
        title: 'Missed and After-Hours Calls',
        body:
          'Calls that arrive while crews are on a roof, while the office is at lunch, or at nine at night after a storm. AI-assisted answering can take the call, capture the address and the problem, and pass a usable summary to your team.',
      },
      {
        icon: 'cloud-lightning',
        title: 'Storm Surges',
        body:
          'A hail event does not schedule itself around your staffing. A system that answers and captures every inquiry during a surge means the week is not decided by who happened to be free to pick up.',
      },
      {
        icon: 'zap',
        title: 'Speed to Lead',
        body:
          'Web forms, paid leads, and calls all answered quickly and consistently rather than whenever someone gets to the inbox — including the ones that arrive at the worst possible moment.',
      },
      {
        icon: 'calendar-clock',
        title: 'Estimate Scheduling',
        body:
          'Getting the inspection or estimate onto the calendar while the homeowner is still on the phone or still reading the reply, instead of after three rounds of phone tag.',
      },
      {
        icon: 'repeat',
        title: 'Unsold Estimates and Old Leads',
        body:
          'Estimates that were delivered and never answered, and last year’s leads sitting in the CRM. Follow-up sequences that keep running without anyone having to remember them.',
      },
      {
        icon: 'bar-chart-3',
        title: 'Marketing Attribution',
        body:
          'Connecting the ad, the search, or the door knock to what it actually produced — so you can tell which spend is worth repeating instead of guessing from lead counts.',
      },
    ],
  },

  boundaries: {
    eyebrow: 'What This Is Not',
    heading: 'Better Handoffs, Not Fewer People',
    items: [
      {
        title: 'We work with what you already run',
        body:
          'This connects to your existing CRM, phone system, and scheduling. Ripping those out is a separate decision and usually a bad one to bundle into this.',
      },
      {
        title: 'Nobody gets replaced',
        body:
          'The point is that your office staff stop re-typing addresses and chasing callbacks, and your sales team walk into appointments that were actually confirmed. Capacity and consistency, not headcount.',
      },
      {
        title: 'No promises about booked jobs',
        body:
          'Nothing here guarantees appointments, sold jobs, or revenue — anyone who tells you otherwise is selling something. What a system can do is respond faster and more consistently than a busy office can on its worst week.',
      },
      {
        title: 'A person is always reachable',
        body:
          'Automated response is the floor, not the ceiling. Anything that needs a human — an angry customer, an active leak, an insurance question — routes to one.',
      },
    ],
  },

  call: {
    eyebrow: 'The Call',
    heading: 'Thirty Minutes, About Your Operation',
    intro:
      'A working conversation about how leads reach you now and where they stall — not a product demonstration.',
    items: [
      {
        icon: 'search',
        title: 'What happens now',
        body:
          'Where your leads come from, who answers, what happens after hours and during a surge, and which parts depend on somebody remembering to follow up.',
      },
      {
        icon: 'list-checks',
        title: 'Where automation actually fits',
        body:
          'Which of the six areas above would change anything for your company, and which ones would not be worth the effort at your volume.',
      },
      {
        icon: 'route',
        title: 'What a first build would involve',
        body:
          'A concrete sense of scope, sequencing, and what connecting to your current CRM and phone setup would take — enough to judge whether it is worth going further.',
      },
    ],
    faqs: [
      {
        question: 'Will this replace my office staff?',
        answer:
          'No. Most roofing companies we talk to are short-handed in the office already. The work goes to the repetitive parts — answering during a surge, capturing details, confirming appointments, chasing unsold estimates — so your people spend their time on the calls that need a person.',
      },
      {
        question: 'Will it work with our CRM?',
        answer:
          'That is the starting assumption. How it connects depends on what your CRM supports — a direct API, a webhook, or an integration platform — and working that out honestly is part of the call. If a system genuinely cannot be connected, we would rather tell you than build a workaround that leaves your data in two places.',
      },
      {
        question: 'What happens during a hail event when volume triples?',
        answer:
          'That is the case worth designing for, and it is the one that exposes whatever is fragile the rest of the year. A system that answers and captures consistently during a surge is worth more than one that is slightly faster on a normal Tuesday.',
      },
      {
        question: 'Do homeowners know they are talking to an AI system?',
        answer:
          'Yes. Disclosure is the right call practically as well as ethically — the systems that work are the ones where a caller understands what they are talking to and can reach a person when they need one.',
      },
      {
        question: 'What does it cost?',
        answer:
          'It depends on scope, and quoting a number before understanding your volume and your systems would be guessing. The call is free and carries no obligation; if there is a fit, you get a concrete scope and price afterwards.',
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
    heading: 'See Where Your Leads Are Actually Going',
    body:
      'Thirty minutes on how leads reach your company today, where they stall, and which parts of that are worth automating. If the answer is "not much yet", that is a useful outcome too.',
    cta: {
      label: CTA_LABEL,
      compactLabel: 'Book My Strategy Call',
      href: SCHEDULING.strategyCall.url,
      type: 'strategy_call',
      microcopy: CTA_MICRO,
    },
    whatHappens: [
      'You pick a time that works — the calendar opens straight away.',
      'We ask how your leads and calls are handled today before proposing anything.',
      'You leave with a clear view of what would and would not be worth building.',
    ],
  },
};
