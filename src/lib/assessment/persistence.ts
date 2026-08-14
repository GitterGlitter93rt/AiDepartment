// Client-side draft persistence.
// Stores only what's necessary to resume an in-progress assessment after an
// accidental refresh: the answer map and the assessment version. Nothing
// else is persisted. See docs/04-assessment/consent-and-data.md
// "DATA MINIMIZATION".

import { ASSESSMENT_VERSION, type AnswerMap } from '../../data/assessment/types';

const DRAFT_KEY = 'yad_assessment_draft_v1';
const RESULT_KEY = 'yad_assessment_result_v1';
const CONTACT_KEY = 'yad_assessment_contact_v1';

interface StoredDraft {
  assessmentVersion: typeof ASSESSMENT_VERSION;
  answers: AnswerMap;
  updatedAt: string;
}

export function saveDraft(answers: AnswerMap): void {
  if (typeof window === 'undefined') return;
  const payload: StoredDraft = { assessmentVersion: ASSESSMENT_VERSION, answers, updatedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  } catch {
    // Storage unavailable (private browsing, quota) — fail silently; the
    // assessment still works in-memory for the current session.
  }
}

export function loadDraft(): AnswerMap | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (parsed.assessmentVersion !== ASSESSMENT_VERSION) return null; // stale version — start fresh
    return parsed.answers;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(DRAFT_KEY);
}

export function saveResult(resultJson: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RESULT_KEY, resultJson);
  } catch {
    // ignore
  }
}

export function loadResultRaw(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(RESULT_KEY);
}

export interface ContactInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: string;
  website?: string;
  marketingOptIn: boolean;
}

export function saveContact(contact: ContactInfo): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONTACT_KEY, JSON.stringify(contact));
  } catch {
    // ignore
  }
}

export function loadContact(): ContactInfo | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CONTACT_KEY);
    return raw ? (JSON.parse(raw) as ContactInfo) : null;
  } catch {
    return null;
  }
}
