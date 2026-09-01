// Paid-social VSL funnel: personal injury law firms.
//
// POSITIONING: Law Firm AI Growth + Intake System — consultative and
// high-ticket. No checkout, no self-serve purchase.
//   Implementation approx. $15,000-$25,000.
//   Ongoing approx. $2,500-$5,000+/month.
//   Advertising spend separate.
//
// NINE sections. Price is deliberately NOT in the hero — attorneys are
// qualified on fit first, investment later.
//
// LEGAL BOUNDARY carried in system.boundaries and the FAQ: the AI does
// not give legal advice, does not evaluate the merits of a claim, and
// does not predict outcomes.

// See the import-extension note in plumbing-ai.ts.
import { SCHEDULING } from '../../lib/scheduling.ts';
import type { FunnelConfig } from '../../lib/funnels/types';

const STRATEGY_CTA = {
  label: 'Book a Law Firm AI Growth Strategy Call',
  href: SCHEDULING.strategyCall.url,
  type: 'strategy_call' as const,
  // One consistent line. The previous "not a pitch deck" phrasing
  // repeated four times down the page and read as defensive.
  microcopy: '30-minute working session focused on your acquisition, intake, and follow-up process.',
};

export const personalInjuryAiFunnel: FunnelConfig = {
  slug: 'personal-injury-ai',
  path: '/personal-injury-ai/',
  vertical: 'personal_injury',
  funnelId: 'personal_injury_ai',
  creativePrefix: 'pi_ugc_vsl',
  campaignName: 'personal_injury_ai',

  seo: {
    title: 'AI Growth & Intake Systems for Personal Injury Firms | Your AI Department',
    description:
      'We build and manage the system between the ad click and the scheduled consultation for personal injury firms — campaigns, intake, follow-up, scheduling, CRM workflows, and attribution.',
    robots: 'noindex, follow',
  },

  vsl: undefined,

  hero: {
    eyebrow: 'For Personal Injury Law Firms',
    headline: 'Your Firm May Not Need More Leads.',
    headlineLine2: 'It May Need to Stop Losing the Ones It Already Paid For.',
    subhead:
      'Your AI Department builds and manages the entire system between the ad click and the scheduled consultation — campaigns, intake, follow-up, scheduling, CRM, and attribution.',
    bullets: [
      'Intake that responds immediately, including nights and weekends',
      'Follow-up that continues past the first missed connection',
      'Reporting that shows which campaigns produce signed clients, not just calls',
    ],
    cta: STRATEGY_CTA,
  },

  leak: {
    eyebrow: 'Where It Leaks',
    heading: 'The Failure Is Rarely at the Top of the Funnel',
    intro:
      'Acquisition is a chain. The firm pays full price for every link before the one that breaks, which is why efficiency is usually a systems problem before it is a media-buying problem.',
    flow: {
      steps: [
        { label: 'Traffic', icon: 'megaphone' },
        { label: 'Lead', icon: 'inbox' },
        { label: 'Response', icon: 'timer' },
        { label: 'Intake', icon: 'clipboard-list' },
        { label: 'Qualification', icon: 'list-checks' },
        { label: 'Consultation', icon: 'calendar-check' },
        { label: 'Follow-Up', icon: 'repeat' },
        { label: 'Attribution', icon: 'bar-chart-3' },
      ],
    },
    items: [
      {
        icon: 'timer',
        title: 'Response time',
        body: 'When a prospective client contacts more than one firm, response speed can influence who gets the conversation first. Additional ad spend does not recover that.',
      },
      {
        icon: 'phone-missed',
        title: 'Off-hours inquiries',
        body: 'Accidents do not happen on a business-hours schedule. Inquiries that arrive outside staffed hours often meet the least coverage.',
      },
      {
        icon: 'repeat',
        title: 'Follow-up that stops',
        body: 'Someone who missed the first callback is not a dead lead. Without a defined sequence, whether they hear from you again depends on individual memory.',
      },
      {
        icon: 'file-search',
        title: 'Attribution that stops at the form fill',
        body: 'Cost per lead is measurable. Cost per signed case often is not, so campaigns that produce volume and campaigns that produce clients look alike in reporting.',
      },
    ],
  },

  system: {
    eyebrow: 'The System',
    heading: 'One Accountable System, Not Four Vendors',
    paragraphs: [
      'Losses tend to occur at handoffs — agency to intake, intake to calendar, CRM to reporting. When one party owns the chain, those handoffs stop being anyone\'s blind spot.',
      'AI is used where consistency matters and judgment does not: responding immediately, capturing information accurately, applying your firm\'s criteria, scheduling, and running follow-up on time.',
    ],
    pillars: [
      {
        icon: 'megaphone',
        title: 'ACQUIRE',
        subtitle: 'Ads + landing pages',
        body: 'Google Ads and, where it fits, Meta — pointed at pages built for one campaign and one next step, not a general practice-area page.',
      },
      {
        icon: 'phone-call',
        title: 'ANSWER',
        subtitle: 'AI intake + missed-call recovery',
        body: 'New-inquiry calls answered immediately, day or night, with your intake script and information requirements applied every time.',
      },
      {
        icon: 'calendar-check',
        title: 'CONVERT',
        subtitle: 'Qualification, scheduling, follow-up',
        body: 'Firm-approved screening, consultations booked onto the right attorney\'s calendar, and sequenced follow-up for anyone who did not connect first time.',
      },
      {
        icon: 'bar-chart-3',
        title: 'MEASURE',
        subtitle: 'CRM + attribution + reporting',
        body: 'Pipeline workflows, integrations, and attribution carried through to the outcome, so you can see which campaigns produce signed matters.',
      },
    ],
    boundaries: [
      { title: 'No legal advice', body: 'It does not answer legal questions or advise a prospective client on what to do. Those conversations belong to attorneys.' },
      { title: 'No merits evaluation', body: 'It applies your firm\'s intake criteria as screening rules. Whether a matter is worth taking is your determination.' },
      { title: 'No outcome predictions', body: 'No case values, no likelihood of success, no timelines.' },
    ],
  },

  deliverables: {
    eyebrow: 'Scope',
    heading: 'What We Build and Manage',
    intro: 'Firms engage across all of it or a subset. Most begin with intake and attribution.',
    items: [
      'Google Ads strategy, build, and management',
      'Meta campaigns where they fit the practice area',
      'Campaign landing pages',
      'AI-assisted intake call handling, day and night, with firm-approved qualification',
      'Missed-call recovery on unanswered and abandoned inquiries',
      'Consultation scheduling and attorney routing',
      'SMS, email, and outbound follow-up sequences, plus consultation reminders',
      'CRM workflows, pipeline stages, and integrations',
      'GA4 and Google Tag Manager conversion tracking',
      'Creative-level attribution and performance reporting',
    ],
  },

  offer: {
    eyebrow: 'Investment',
    heading: 'A Customized Engagement, Scoped to Your Firm',
    name: 'Law Firm AI Growth + Intake System',
    summary:
      'An integrated acquisition, intake, follow-up, CRM, and attribution system — not a standalone advertising or answering-service engagement. The ranges below are typical, so you can decide whether a conversation is worth your time.',
    priceLines: [
      { label: 'Typical implementation', value: '$15,000 – $25,000', note: 'One-time. Varies with practice areas, offices, integrations, and which layers are in scope.' },
      { label: 'Typical ongoing services', value: '$2,500 – $5,000+/mo', note: 'Varies with campaign scope and intake volume. Advertising spend is separate, paid directly to the platforms.' },
    ],
    includesTitle: 'What shapes the number',
    includes: [
      'How many practice areas and offices are in scope',
      'Whether campaigns and landing pages are included or already handled',
      'Which CRM and case-management systems need integrating',
      'How much follow-up and reporting we manage for you',
      'Final scope and pricing come from a written proposal after discovery',
    ],
    footnotes: [
      'Ranges are typical, not a quote. Advertising spend and third-party software are billed to the firm directly.',
      'Many firms start with intake and attribution, then add the marketing layer.',
    ],
    cta: STRATEGY_CTA,
  },

  process: {
    eyebrow: 'How Engagement Works',
    heading: 'Diagnose Before Rebuilding',
    steps: [
      { title: 'Diagnose acquisition + intake', body: 'We map your chain end to end: traffic, lead routing, response times, intake, scheduling, CRM structure, and what your reporting can tell you.' },
      { title: 'Build the system', body: 'Intake configuration to firm-approved criteria, scheduling and routing, follow-up sequences, CRM workflows, and the tracking layer.' },
      { title: 'Launch + integrate', body: 'Campaigns and pages go live into a system that can respond to and measure what they produce — not before.' },
      { title: 'Optimize + report', body: 'Working sessions reviewing intake calls, response times, consultations held, and campaign performance against signed matters.' },
    ],
    note: 'The critical path is usually system access and firm approvals, not the technical work.',
  },

  proof: {
    eyebrow: 'See How It Would Work',
    heading: 'See How the Acquisition System Would Fit Together',
    intro:
      "On the strategy call we'll map your current acquisition and intake process, and show how response, qualification, scheduling, follow-up, CRM, and attribution could fit together for your firm.",
    // What we can genuinely put in front of a firm before any build
    // exists: proposed architecture, not a preconfigured live agent.
    demoSlots: [
      { icon: 'workflow', title: 'Proposed intake flow', body: 'How a new inquiry could move from first contact through firm-approved intake and routing.' },
      { icon: 'calendar-check', title: 'Scheduling path', body: "How qualified inquiries could reach the correct attorney's calendar, with confirmations and reminders." },
      { icon: 'repeat', title: 'Follow-up sequence', body: 'An example sequence for inquiries that do not connect on the first attempt.' },
      { icon: 'bar-chart-3', title: 'Attribution architecture', body: 'How campaign, ad, and creative identifiers can follow the lead through to your reporting.' },
    ],
  },

  fit: {
    eyebrow: 'Fit & Objections',
    heading: 'This Suits Some Firms and Not Others',
    fitHeading: 'A likely fit if your firm:',
    fitItems: [
      'Already invests meaningfully in client acquisition',
      'Receives enough inquiry volume that response consistency matters',
      'Has intake staff stretched across more than intake',
      'Cannot tell which campaigns produce signed clients rather than leads',
      'Has capacity for additional qualified matters',
    ],
    notFitHeading: 'Likely not a fit if your firm:',
    notFitItems: [
      'Wants a low-cost answering service rather than a built system',
      'Expects a vendor to decide which cases are worth taking',
      'Cannot allocate anyone to discovery and approvals',
    ],
    faqs: [
      {
        question: 'Will AI be giving legal advice to prospective clients?',
        answer:
          'No, and it is configured so it cannot. It does not answer legal questions or advise on what someone should do — it collects what your firm needs, applies your screening criteria, and schedules a consultation. Anything approaching a legal question routes to a person.',
      },
      {
        question: 'Who decides whether a case is worth taking?',
        answer:
          'Your firm, without exception. The system applies the intake criteria you define and approve — case type, jurisdiction, incident date, treatment status, representation — as a screening step. Screening is clerical; evaluating a matter stays with your attorneys.',
      },
      {
        question: 'What about confidentiality and disclosure?',
        answer:
          'Your firm approves the greeting, disclaimers, and confidentiality language before anything goes live, and disclosure is configured to your jurisdiction. Data handling is scoped during discovery against your obligations. Recording and transcription are used only where lawful, disclosed, and authorized by your firm.',
      },
      {
        question: 'We already have an intake team and an agency. Does this replace them?',
        answer:
          'Not necessarily. It covers hours your team is not working and absorbs overflow when several inquiries land at once. Firms often keep an existing agency on campaigns while we take intake, follow-up, and attribution — provided everyone shares one definition of a conversion.',
      },
      {
        question: 'Why is implementation $15,000 to $25,000?',
        answer:
          'It is a customized build: campaigns, landing pages, an intake system configured to your criteria and approved language, follow-up sequences, CRM workflows and integrations, and working attribution — plus discovery, testing, and launch. The final figure comes from a written proposal.',
      },
      {
        question: 'Can we start smaller?',
        answer:
          'Yes, and it is often the sensible path. Many firms begin with intake and attribution, where the recoverable losses usually sit, then add the marketing layer once the chain holds.',
      },
    ],
    cta: STRATEGY_CTA,
  },

  close: {
    eyebrow: 'Next Step',
    heading: "Bring Us Your Current Acquisition Chain. We'll Show You Where It Can Be Strengthened.",
    body:
      'If your intake is already sound and the issue is elsewhere, we will tell you that.',
    cta: STRATEGY_CTA,
    whatHappens: [
      'We map your acquisition chain from traffic through to signed client',
      'We identify where response, follow-up, or measurement is breaking down',
      'You get a straight answer on scope, phasing, and realistic investment',
    ],
  },
};
