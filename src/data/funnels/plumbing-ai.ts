// Paid-social VSL funnel: plumbing companies.
//
// OFFER: AI Front Desk + Booking & Follow-Up System
//   $5,000 implementation, ongoing service starting at $500/month.
//
// EIGHT sections. Copy rules honored throughout:
//   - no testimonials, client names, reviews, logos, or case studies
//   - no industry statistics and no "X% of calls" claims
//   - the one concrete sequence (proof.workflow) is explicitly labeled
//     illustrative and carries a mandatory disclaimer
//   - $500/month is always "starting at", never unlimited
//   - paragraphs run 1-3 sentences; cards run 15-45 words

// NOTE ON IMPORT EXTENSIONS: the runtime import below carries an
// explicit .ts extension (allowed by astro/tsconfigs/base.json's
// allowImportingTsExtensions, resolved natively by Vite). Deliberate:
// it makes this module importable by the Node test runner, so
// tests/paidSocialFunnels.test.ts asserts against the REAL config —
// actual price strings, actual CTA labels — not regexed source text.
import { SCHEDULING } from '../../lib/scheduling.ts';
import type { FunnelConfig } from '../../lib/funnels/types';

// The next step is a STRATEGY CALL, not a product demo. We build custom
// AI Front Desk implementations; there is no off-the-shelf voice demo to
// play, and promising one sets an expectation the sales process cannot
// meet. The duration and price claim below is verified against
// SCHEDULING.strategyCall (30 minutes, price: null) — do not state a
// duration that is not configured there.
const STRATEGY_CTA = {
  label: 'Book My AI Front Desk Strategy Call',
  // Shorter label for the mobile sticky bar only; the full label is used
  // everywhere else.
  compactLabel: 'Book My Strategy Call',
  href: SCHEDULING.strategyCall.url,
  type: 'strategy_call' as const,
  // Kept tight on purpose: this line renders under all four in-page
  // CTAs, so every extra word costs four times over.
  microcopy:
    'Free 30-minute strategy call. We map your current call and booking process and show you where an AI Front Desk would fit.',
};

export const plumbingAiFunnel: FunnelConfig = {
  slug: 'plumbing-ai',
  path: '/plumbing-ai/',
  vertical: 'plumbing',
  funnelId: 'plumbing_ai',
  creativePrefix: 'plumbing_ugc_vsl',
  campaignName: 'plumbing_ai',

  seo: {
    title: 'AI Front Desk for Plumbing Companies | Your AI Department',
    description:
      'An AI front desk that answers plumbing calls, covers after hours, books appointments, and follows up on estimates. $5,000 implementation, ongoing service starting at $500/month.',
    // Paid landing page, deliberately excluded from search so it does
    // not compete with /industries/plumbing/. "follow" so internal
    // links still pass equity.
    robots: 'noindex, follow',
  },

  // No VSL asset configured yet — the hero renders as a wide copy-led
  // layout, with no empty player well. Drop the file in /public/video/
  // and fill this in; see docs/funnels/paid-social-funnel-system.md.
  vsl: undefined,

  hero: {
    eyebrow: 'For Plumbing Companies',
    headline: 'Turn More Plumbing Calls Into Booked Jobs',
    headlineLine2: 'Without Adding Another Full-Time Dispatcher',
    subhead:
      "We build your company an AI Front Desk that can answer calls, capture lead information, help schedule appointments, and follow up with opportunities — so more of the calls you're already generating get handled consistently.",
    priceAnchor: [
      { label: 'Implementation', value: '$5,000' },
      { label: 'Ongoing', value: 'From $500/mo' },
    ],
    bullets: [
      'Answers when your lines are busy and after you close',
      'Books straight into the schedule your office already uses',
      'Chases missed calls and open estimates without anyone remembering to',
    ],
    cta: STRATEGY_CTA,
  },

  leak: {
    eyebrow: 'The Leak',
    heading: 'You Already Paid for That Call.',
    intro:
      'The Google Ads click, the LSA fee, the years of referrals — all of it is spent by the time your phone rings. Three moments decide whether it becomes a job.',
    items: [
      {
        icon: 'phone-missed',
        title: 'Missed call',
        body: 'Every line is busy and it rings out. They call the next plumber on the list, and they do not call you back.',
      },
      {
        icon: 'moon',
        title: 'After hours',
        body: "It's 6:40pm and a water heater is leaking into a garage. They get your voicemail greeting. Most people do not leave a message.",
      },
      {
        icon: 'clipboard-list',
        title: 'No follow-up',
        body: 'The repipe estimate went out and nothing happened after that. It did not get lost — it went quiet, and quiet gets read as a no.',
      },
    ],
  },

  system: {
    eyebrow: 'The Mechanism',
    heading: 'Your AI Front Desk',
    name: 'Your AI Front Desk',
    paragraphs: [
      'It picks up the work your office cannot always get to: answering when every line is busy, covering nights and weekends, collecting what a job needs, booking the appointment, and following up afterward.',
      'It is built around your call flow — your service area, your job types, your rules about what can be quoted on the phone, your escalation triggers. If you do not do septic work, it does not book septic work.',
    ],
    flow: {
      steps: [
        { label: 'Call comes in', icon: 'phone-call' },
        { label: 'AI answers', icon: 'bot' },
        { label: 'Qualifies', icon: 'list-checks' },
        { label: 'Books the job', icon: 'calendar-check' },
        { label: 'Follows up', icon: 'repeat' },
        { label: 'Escalates to a human', icon: 'user-check' },
      ],
    },
    capabilities: [
      { icon: 'phone-call', title: 'Inbound call answering', body: 'Picks up when your lines are busy, greets callers in your company\'s voice, and works through your intake questions.' },
      { icon: 'moon', title: 'After-hours coverage', body: 'Nights, weekends, and holidays get a real conversation instead of a voicemail box — with your rules for what counts as urgent.' },
      { icon: 'calendar-check', title: 'Appointment booking', body: 'Books into your live availability, respecting job durations, dispatch zones, and the slots you keep open for emergencies.' },
      { icon: 'phone-missed', title: 'Missed-call recovery', body: 'A call that rings out gets an immediate text back, so the caller has a live path to you before they dial a competitor.' },
      { icon: 'clipboard-list', title: 'Estimate & lead follow-up', body: 'Open quotes and unbooked inquiries get a structured follow-up sequence instead of depending on who remembers what.' },
      { icon: 'message-square', title: 'SMS + human escalation', body: 'Confirmations and reminders go out automatically; anything urgent or unusual transfers to your team by your definition of those words.' },
    ],
    boundaries: [
      { title: 'It does not replace your team', body: 'It handles the repeatable phone work so your office staff can do what actually needs them.' },
      { title: 'It does not diagnose or price', body: 'Diagnosis, code questions, and pricing judgment stay with your plumbers. It collects information and books the visit.' },
      { title: 'It hands off when it should', body: 'You define what must always reach a person. Those calls get transferred or flagged, not handled by a machine.' },
    ],
  },

  offer: {
    eyebrow: 'The Offer',
    heading: 'One Build. Then We Run It.',
    name: 'AI Front Desk + Booking & Follow-Up System',
    summary:
      'A custom implementation built around how your company actually takes calls, then ongoing service to run, monitor, and improve it.',
    priceLines: [
      { label: 'Custom implementation', value: '$5,000', note: 'One-time. Everything in the build list.' },
      { label: 'Ongoing service', value: 'From $500/month', note: 'Quoted to your configuration. Not an unlimited-usage plan.' },
    ],
    includesTitle: 'The $5,000 implementation covers',
    includes: [
      'Mapping how calls, dispatch, and follow-up work in your company today',
      'Call-flow design, including after-hours and escalation rules',
      'AI agent setup — voice, tone, and your intake questions',
      'Company knowledge: service area, job types, what may be quoted by phone',
      'Scheduling configuration against your real availability',
      'Phone, text, and follow-up workflow build',
      'CRM and calendar integrations where technically practical',
      'Testing against real call scenarios, launch, and initial optimization',
    ],
    footnotes: [
      'Monthly starts at $500 and varies by configuration — call volume, outbound calling, SMS volume, integrations, locations, workflow complexity, and support level. Confirmed in writing before launch.',
    ],
    cta: STRATEGY_CTA,
  },

  process: {
    eyebrow: 'How It Works',
    heading: 'Four Steps to a Phone That Always Gets Answered',
    steps: [
      { title: 'Map your call & booking process', body: 'How calls come in now, who handles what, what happens after hours, and where things currently fall through.' },
      { title: 'Build + configure the AI front desk', body: 'Call flow, intake questions, qualification rules, service knowledge, escalation triggers, and booking logic — plus your CRM and calendar.' },
      { title: 'Test real scenarios', body: 'The routine drain clog, the after-hours leak, the price shopper, the caller outside your area, the one who needs a human immediately.' },
      { title: 'Launch + optimize', body: 'Go live on your terms — after hours only, overflow only, or full coverage — then tune it against real calls.' },
    ],
    note:
      'Timeline depends mostly on how quickly we get access to your phone system, calendar, and CRM, and on decisions about your call rules. We give you a real one on the strategy call.',
  },

  proof: {
    eyebrow: 'See How It Works',
    heading: 'See How the System Would Work',
    intro:
      "On the call we'll map a real plumbing call from first contact through qualification, scheduling, follow-up, and human escalation, so you can see how the workflow would fit your operation.",
    workflow: {
      // Labeled, ordered, and worded so it can never be mistaken for a
      // recording, a transcript, or a real customer interaction.
      label: 'Example AI Front Desk Workflow — illustrative',
      heading: 'An after-hours call, step by step',
      steps: [
        { marker: '8:47 PM', text: '— incoming customer call. Your office closed hours ago.' },
        { marker: 'Answers', text: '— the AI Front Desk picks up.' },
        { marker: 'Identifies', text: '— works out what the service request is.' },
        { marker: 'Collects', text: '— customer and location information, to the fields you require.' },
        { marker: 'Checks', text: '— looks at the configured scheduling workflow.' },
        { marker: 'Books or routes', text: '— takes the next appropriate step under your rules.' },
        { marker: 'Confirms', text: '— sends confirmation and follow-up.' },
        { marker: 'Escalates', text: '— hands off to a human when the situation requires it.' },
      ],
      disclaimer:
        'This is an illustrative workflow showing how a configured AI Front Desk would behave. It is not a recording, not a transcript, not a real customer interaction, and not a claim about results. Your rules would decide every step above.',
    },
    // What we actually do on the strategy call. Deliberately not a
    // product demonstration — we have no generic voice demo to play, and
    // saying otherwise would set an expectation the call cannot meet.
    demoSlots: [
      { icon: 'workflow', title: 'Your current call flow, mapped', body: 'Who answers today, what happens after hours, and where calls are dropping.' },
      { icon: 'search', title: 'Where opportunities fall through', body: 'Missed calls, unreturned inquiries, and estimates that went quiet — against your real process.' },
      { icon: 'settings', title: 'How yours would be configured', body: 'Which calls get booked, which get qualified, and which escalate straight to your team.' },
      { icon: 'clipboard-check', title: 'Scope, timeline and real numbers', body: 'What the $5,000 implementation would cover for you, and what your ongoing monthly would actually be.' },
    ],
  },

  fit: {
    eyebrow: 'Fit & Objections',
    heading: 'This Fits Some Plumbing Companies and Not Others',
    fitHeading: 'A good fit if you are:',
    fitItems: [
      'An established company already generating leads from Google Ads, LSAs, SEO, or referrals',
      'Handling enough call volume that calls genuinely get missed',
      'Losing after-hours and weekend calls to voicemail',
      'Frustrated by inconsistent follow-up on estimates and unbooked inquiries',
      'Able to take on more work if more of it got booked',
    ],
    notFitHeading: 'Probably not a fit if:',
    notFitItems: [
      'You are a one-truck operation with more work than you can handle',
      'Your phone rarely rings and the real problem is demand, not intake',
      'You want the cheapest possible answering service rather than a built system',
    ],
    faqs: [
      {
        question: 'Will callers know they are talking to AI?',
        answer:
          'We recommend being upfront, and we configure the greeting to your preference and to the disclosure rules where you operate. In practice most callers care far more about being answered quickly than about who picked up. What frustrates people is a voicemail box.',
      },
      {
        question: 'Can it transfer to a real person, and book actual appointments?',
        answer:
          'Both, and both are configured during the build. You decide what must always reach a human — a specific emergency, an existing customer with a complaint, a commercial account — and it transfers or flags it. For booking, it works against your real availability, job durations, and dispatch zones, so what it books is something your team can actually run.',
      },
      {
        question: 'What happens when it does not know the answer?',
        answer:
          'It says so and routes the caller rather than guessing. That is deliberate: a confident wrong answer about a price, a warranty, or whether you service an area does far more damage than an honest handoff. Gaps we find in real calls get fixed during optimization.',
      },
      {
        question: 'Can it integrate with our CRM and scheduling software?',
        answer:
          'Usually yes, and we scope it during discovery rather than promising it blind. Common field-service and CRM platforms are well covered. You keep your own phone numbers, CRM, and scheduling tools, and any third-party telephony or SMS costs are billed to you directly by those providers.',
      },
      {
        question: 'Why does the setup cost $5,000?',
        answer:
          'Because it is a build, not a signup: discovery, call-flow design, agent and knowledge configuration, scheduling setup, phone and text workflows, follow-up sequences, integrations, testing, launch, and post-launch optimization. A cheaper option always exists; it is generally a generic bot that has never heard of your service area.',
      },
      {
        question: 'How does this compare to hiring someone or using an answering service?',
        answer:
          'A hire brings judgment a system does not have, but covers one shift and takes vacations. An answering service takes a message reliably — the gap is what happens next, since a message is not a qualified appointment written into your schedule with a confirmation sent. This is built to close that gap, not to replace your office.',
      },
    ],
    cta: STRATEGY_CTA,
  },

  close: {
    eyebrow: 'Your AI Front Desk',
    heading: "Bring Us Your Current Call Flow. We'll Show You How an AI Front Desk Could Fit Into It.",
    body:
      "Walk us through what happens when a new customer calls, what happens after hours, how appointments get booked, and how estimates and unbooked leads are followed up. We'll show you where AI and automation could help your team respond more consistently.",
    cta: STRATEGY_CTA,
    whatHappens: [
      'We map your current call, booking, and follow-up process',
      'We identify where opportunities are falling through today',
      'You get a straight answer on scope, timeline, and your actual monthly',
    ],
  },
};
