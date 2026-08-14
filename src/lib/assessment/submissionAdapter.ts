// Submission adapter — INTENTIONALLY NOT WIRED TO A BACKEND.
//
// Per Sprint 2 scope: "Do not build CRM integration / email automation in
// this sprint" and "Do not pretend submissions are being delivered if they
// are not." This function exists so the contact-capture UI has a single,
// clearly-labeled integration point for a future backend, and so that no
// other code needs to change when that backend exists.
//
// Current behavior: stores contact + assessment data locally only (see
// persistence.ts) and resolves successfully so the UI flow can proceed.
// It does NOT send an email, does NOT call an API, and does NOT create a
// CRM record. Replace the body of this function when backend
// infrastructure exists — nothing else in the assessment UI should need
// to change.

import type { ContactInfo } from './persistence';
import type { FullAssessmentResult } from '../../data/assessment/types';

export interface SubmissionPayload {
  contact: ContactInfo;
  result: FullAssessmentResult;
}

export interface SubmissionOutcome {
  delivered: false; // always false until a real backend is implemented
  storedLocally: true;
}

export async function submitAssessment(payload: SubmissionPayload): Promise<SubmissionOutcome> {
  // Deliberately not sending payload anywhere external yet.
  void payload;
  return { delivered: false, storedLocally: true };
}
