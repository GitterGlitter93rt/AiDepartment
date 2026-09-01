// Paid-social VSL funnel: divorce and family law firms.
//
// POSITIONING: AI Lead Generation + Intake System for Family Law Firms.
//   Implementation approx. $10,000-$20,000.
//   Ongoing approx. $2,500-$5,000+/month.
//   Advertising spend separate.
//
// EIGHT sections — this funnel merges its process steps into the proof
// section (proof.steps) rather than running a standalone one.
//
// SENSITIVITY RULES enforced throughout:
//   - this sells to FIRMS, never to people in crisis
//   - no exploitation of custody fear, domestic violence, children, or
//     financial distress as a persuasion device
//   - no urgency manufactured out of someone else's worst month
//   - the person contacting a family law firm is described with dignity
// The commercial argument rests on responsiveness and professionalism,
// which is also what serves the person making the call.
//
// LEGAL BOUNDARY: no legal advice, no assessment of a matter, no
// outcome predictions.

// See the import-extension note in plumbing-ai.ts.
import { SCHEDULING } from '../../lib/scheduling.ts';
import type { FunnelConfig } from '../../lib/funnels/types';

const STRATEGY_CTA = {
  label: 'Book a Family Law AI Growth Strategy Call',
  href: SCHEDULING.strategyCall.url,
  type: 'strategy_call' as const,
  microcopy: '30-minute working session focused on how your firm handles first contact.',
};

export const divorceLawAiFunnel: FunnelConfig = {
  slug: 'divorce-law-ai',
  path: '/divorce-law-ai/',
  vertical: 'divorce_law',
  funnelId: 'divorce_law_ai',
  creativePrefix: 'divorce_ugc_vsl',
  campaignName: 'divorce_law_ai',

  seo: {
    title: 'AI Lead Generation & Intake for Family Law Firms | Your AI Department',
    description:
      'Marketing, intake, scheduling, follow-up, and attribution systems that help divorce and family law firms respond consistently from first inquiry through consultation.',
    robots: 'noindex, follow',
  },

  vsl: undefined,

  hero: {
    eyebrow: 'For Divorce & Family Law Firms',
    headline: 'Family-Law Inquiries Move Fast.',
    headlineLine2: 'Your Intake and Follow-Up Should Too.',
    subhead:
      'We build and manage the marketing, intake, scheduling, follow-up, and attribution systems that help your firm respond consistently from first inquiry through consultation.',
    bullets: [
      'A calm, professional response to every inquiry, including after hours',
      'Consultations booked while the person is still on the phone',
      'Reporting that shows which campaigns produce retained clients',
    ],
    cta: STRATEGY_CTA,
  },

  leak: {
    eyebrow: 'First Contact',
    heading: 'First Contact Matters When Prospective Clients Are Comparing Firms',
    intro:
      'People approaching a family law firm have often thought about it for a while before they act. The experience of that first contact can carry real weight in who they choose.',
    items: [
      {
        icon: 'timer',
        title: 'The inquiry that waits',
        body: 'Someone who took a while to decide to call, then reaches voicemail, has been given a reason to try the next name on their list.',
      },
      {
        icon: 'moon',
        title: 'Contact outside office hours',
        body: 'Some first inquiries come in outside office hours, when immediate human coverage may be limited.',
      },
      {
        icon: 'calendar',
        title: 'Scheduling friction',
        body: '"Someone will get back to you about scheduling" adds a step, and every extra step is a place where a hesitant inquiry can stop.',
      },
      {
        icon: 'repeat',
        title: 'Follow-up that ends after one attempt',
        body: 'Someone not ready this month may be ready later. Without a sequence, whether they hear from you again depends on who happens to remember.',
      },
    ],
  },

  system: {
    eyebrow: 'The System',
    heading: 'The System Around First Contact',
    paragraphs: [
      'We build and manage the path from the moment someone finds your firm to the moment they sit down with an attorney — and the reporting that shows what happened.',
      'Tone is a design requirement, not a finishing touch. Intake is brief, calm, and plain: collect what your firm needs, book the consultation, and never ask someone to narrate their situation to a machine.',
    ],
    flow: {
      steps: [
        { label: 'Lead generation', icon: 'megaphone' },
        { label: 'Intake', icon: 'clipboard-list' },
        { label: 'Qualification', icon: 'list-checks' },
        { label: 'Scheduling', icon: 'calendar-check' },
        { label: 'Follow-up', icon: 'repeat' },
        { label: 'Attribution', icon: 'bar-chart-3' },
      ],
    },
    boundaries: [
      { title: 'No legal advice', body: 'No answers to legal questions and no guidance on what someone should do. Those are conversations for your attorneys.' },
      { title: 'No assessment, no predictions', body: 'It applies your firm\'s intake criteria as screening rules. It forms no view of a matter and says nothing about outcomes.' },
      { title: 'It routes rather than probes', body: 'It is not designed to elicit detail. Anything sensitive, urgent, or outside its rules goes straight to a person on your team.' },
    ],
  },

  deliverables: {
    eyebrow: 'Scope',
    heading: 'What We Build and Manage',
    intro: 'Firms engage across all of it or a subset. Most begin with intake, scheduling, and reporting.',
    items: [
      'Google Ads strategy, build, and management',
      'Meta campaigns where they suit the practice area and platform policy',
      'Campaign landing pages',
      'AI-assisted intake on new inquiries, including evenings and weekends',
      'Information collection to your requirements, including conflict-check details',
      'Firm-defined qualification, with immediate routing to a person when needed',
      'Consultation scheduling against real attorney availability, paid models included',
      'Missed-inquiry recovery plus SMS and email follow-up',
      'CRM organization and practice-management integrations',
      'Conversion tracking, attribution, and reporting through to consultations',
    ],
  },

  offer: {
    eyebrow: 'Investment',
    heading: 'Scoped to Your Firm, Quoted After Discovery',
    name: 'AI Lead Generation + Intake System for Family Law Firms',
    summary:
      'An integrated lead generation, intake, scheduling, follow-up, and reporting system rather than a packaged product. The ranges below are typical, so you can judge whether a conversation is worth your time.',
    priceLines: [
      { label: 'Typical implementation', value: '$10,000 – $20,000', note: 'One-time. Varies with complexity — attorneys, offices, integrations, and what is in scope.' },
      { label: 'Typical ongoing services', value: '$2,500 – $5,000+/mo', note: 'Varies with scope and inquiry volume. Advertising spend is separate, paid directly to the platforms.' },
    ],
    includesTitle: 'What shapes the number',
    includes: [
      'How many attorneys and offices intake and scheduling must route across',
      'Whether campaigns and landing pages are in scope or already handled',
      'Which practice-management and CRM systems need integrating',
      'How much follow-up and reporting we manage for you',
      'Final scope and pricing come from a written proposal after discovery',
    ],
    footnotes: [
      'Ranges are typical, not a quote. Advertising spend and third-party software are billed to the firm directly.',
      'Many firms begin with intake, scheduling, and reporting, then add campaign management later.',
    ],
    cta: STRATEGY_CTA,
  },

  proof: {
    eyebrow: 'See How It Would Work',
    heading: 'See How the System Would Fit Your Firm',
    intro:
      "On the strategy call we'll map how first inquiries currently reach your firm, and show how intake, routing, scheduling, follow-up, and reporting could be structured around your rules.",
    steps: [
      { title: 'Discovery', body: 'How inquiries reach the firm today, who answers, what happens after hours, and how consultations get booked.' },
      { title: 'Define the standard', body: 'Response expectations, intake questions, tone, qualification criteria, and disclaimers. Your firm sets these; we build to them.' },
      { title: 'Build and connect', body: 'Intake, routing, scheduling against real availability, follow-up sequences, CRM organization, and the tracking layer.' },
      { title: 'Launch and refine', body: 'Live on your terms, then reviewed against real intake and reporting in regular working sessions.' },
    ],
    // Proposed architecture we can genuinely walk through before any
    // build exists — not a preconfigured live intake agent.
    demoSlots: [
      { icon: 'workflow', title: 'Proposed first-contact flow', body: 'How a new inquiry could be answered, routed, and handled under firm-approved rules.' },
      { icon: 'calendar-check', title: 'Scheduling path', body: "How consultations could reach the appropriate attorney's calendar, confirmed and reminded." },
      { icon: 'repeat', title: 'Recovery and follow-up', body: 'An example sequence for missed or incomplete inquiries.' },
      { icon: 'bar-chart-3', title: 'Reporting view', body: 'What your firm could measure, from campaign source through to booked consultation.' },
    ],
  },

  fit: {
    eyebrow: 'Fit & Objections',
    heading: 'Which Family Law Firms This Suits',
    fitHeading: 'A likely fit if your firm:',
    fitItems: [
      'Is established, with consistent inquiry volume',
      'Invests in Google Ads, SEO, or referrals and wants better conversion',
      'Loses inquiries to voicemail after hours or during busy periods',
      'Has intake handled by people also managing active matters',
      'Wants consultations booked at first contact, not scheduled later',
    ],
    notFitHeading: 'Likely not a fit if your firm:',
    notFitItems: [
      'Wants the cheapest answering service rather than a built system',
      'Expects AI to handle substantive client conversations',
      'Is looking for high-pressure conversion tactics — not what we build',
    ],
    faqs: [
      {
        question: 'Is AI appropriate for a first conversation in family law?',
        answer:
          'It is a fair question, and it drives how we build. Intake is brief and plain — it does not ask people to explain their situation, and it does not attempt empathy it cannot offer. Its job is to answer promptly, take what your firm needs, and book a consultation.',
      },
      {
        question: 'Can it handle someone who is distressed?',
        answer:
          'It is not asked to. Escalation rules are part of the build: indications of distress, urgency, or safety concerns route immediately to your team, on criteria your firm defines.',
      },
      {
        question: 'What about confidentiality, and will people know it is not a person?',
        answer:
          'Your firm approves the greeting, disclaimers, and wording before anything goes live, and we recommend transparency about what the caller is speaking to. Data handling is scoped during discovery. The system collects only what is needed to schedule — anything sensitive goes to a person.',
      },
      {
        question: 'Can it book consultations, including paid ones, and support conflict checks?',
        answer:
          'Yes to booking — it works against real attorney availability using your routing rules, supports paid consultation models, and sends confirmations and reminders. For conflict checks it collects what your firm needs and routes it into your process; the check itself remains a firm function.',
      },
      {
        question: 'We already have staff answering the phone. What does this add?',
        answer:
          'Coverage when they are not there, capacity when several inquiries arrive at once, and follow-up that runs on a schedule rather than on memory. It reduces what gets missed around your staff, not what they do.',
      },
      {
        question: 'Why is implementation $10,000 to $20,000?',
        answer:
          'It is a build rather than a subscription: discovery, campaign and landing page work where in scope, intake configured to your criteria and wording, scheduling and routing, follow-up, CRM organization, integrations, and tracking. Your figure comes from a written proposal.',
      },
    ],
    cta: STRATEGY_CTA,
  },

  close: {
    eyebrow: 'Next Step',
    heading: 'Start With How Your Firm Answers the Phone.',
    body:
      'A working session on first contact: how inquiries arrive, what happens after hours, and how consultations get booked. If your intake is already strong, we will tell you that rather than sell you something.',
    cta: STRATEGY_CTA,
    whatHappens: [
      'We map how inquiries arrive and get answered today',
      'We look at after-hours coverage and consultation scheduling',
      'You get a straight answer on scope, phasing, and realistic investment',
    ],
  },
};
