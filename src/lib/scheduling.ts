// Centralized Cal.com scheduling source of truth.
// Do not hardcode Cal.com URLs independently across pages — reference
// these exports so a future change (new event, renamed event, provider
// swap) only needs to happen in one place.
//
// No Stripe secrets or private data live here. The Executive AI Advisory
// Session's Stripe payment is configured entirely within Cal.com itself —
// this site only ever links to the public Cal.com booking page.

export interface SchedulingEvent {
  label: string;
  url: string;
  durationMinutes: number;
  price: string | null; // null = free
  intent: string;
}

export const SCHEDULING = {
  strategyCall: {
    label: 'AI Strategy Call',
    url: 'https://cal.com/youraidepartment/ai-strategy-call',
    durationMinutes: 30,
    price: null,
    intent: 'Primary discovery call for most prospects.',
  },
  executiveAdvisory: {
    label: 'Executive AI Advisory Session',
    url: 'https://cal.com/youraidepartment/executive-ai-advisory-session',
    durationMinutes: 60,
    price: '$750',
    intent: 'Paid one-on-one executive advisory session. Payment is processed by Stripe through Cal.com.',
  },
  enterpriseDiscussion: {
    label: 'Enterprise Engagement Discussion',
    url: 'https://cal.com/youraidepartment/enterprise-engagement-discussion',
    durationMinutes: 45,
    price: null,
    intent: 'For larger or more complex organizations.',
  },
  trainingConsultation: {
    label: 'AI Training Consultation',
    url: 'https://cal.com/youraidepartment/ai-training-consultation',
    durationMinutes: 30,
    price: null,
    intent: 'For training and workshop inquiries.',
  },
} as const satisfies Record<string, SchedulingEvent>;
