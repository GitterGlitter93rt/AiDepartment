// Client-side draft persistence for the Quick Score.
// SEPARATE storage keys from the full engine (persistence.ts) so a
// quick-score draft/result/contact can never collide with, or clobber,
// an in-progress 64-question assessment — both engines can have live
// state in the same browser at once.

import { QUICK_ASSESSMENT_VERSION, type QuickAnswerMap } from '../../data/assessment/quickTypes';

const DRAFT_KEY = 'yad_quick_draft_v1';
const RESULT_KEY = 'yad_quick_result_v1';
const CONTACT_KEY = 'yad_quick_contact_v1';

interface StoredQuickDraft {
  assessmentVersion: typeof QUICK_ASSESSMENT_VERSION;
  answers: QuickAnswerMap;
  updatedAt: string;
}

export function saveQuickDraft(answers: QuickAnswerMap): void {
  if (typeof window === 'undefined') return;
  const payload: StoredQuickDraft = { assessmentVersion: QUICK_ASSESSMENT_VERSION, answers, updatedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  } catch {
    // Storage unavailable — the flow still works in-memory this session.
  }
}

export function loadQuickDraft(): QuickAnswerMap | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredQuickDraft;
    if (parsed.assessmentVersion !== QUICK_ASSESSMENT_VERSION) return null; // stale version — start fresh
    return parsed.answers;
  } catch {
    return null;
  }
}

export function clearQuickDraft(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(DRAFT_KEY);
}

export function saveQuickResult(resultJson: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RESULT_KEY, resultJson);
  } catch {
    // ignore
  }
}

export function loadQuickResultRaw(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(RESULT_KEY);
}

export interface QuickContactInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: string;
  website?: string;
  marketingOptIn: boolean;
}

export function saveQuickContact(contact: QuickContactInfo): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONTACT_KEY, JSON.stringify(contact));
  } catch {
    // ignore
  }
}

export function loadQuickContact(): QuickContactInfo | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CONTACT_KEY);
    return raw ? (JSON.parse(raw) as QuickContactInfo) : null;
  } catch {
    return null;
  }
}
