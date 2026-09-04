import { html, raw, type RawHtml } from '../html.js';
import { renderPage, type NavCounts } from '../layout.js';
import { tierBadge, adBadges, channelBadge } from '../components.js';
import { formatDateTime, relativeTime, titleCase } from '../format.js';
import type { SessionUser } from '../../domain/auth.js';
import { isManager } from '../../domain/auth.js';
import {
  endpointLabel, endpointRoleLabel, type AccountDetail, type DetailContact, type DetailEndpoint,
} from '../../domain/accountDetail.js';

/**
 * Account detail. Same content renders as a full page and as the drawer body.
 * Authority: rep-portal-ui-ux-spec.md §11, rep-inventory-contract.v1.yaml account_detail.
 *
 * The order is deliberate: who to call, why, what to ask, then what NOT to claim,
 * then evidence, then history. A rep should understand a company in under a minute.
 */

/** Rep-facing reason text. Never names a registry (purpose limitation, spec §6). */
function explainEligibility(reasons: string[], nextEligibleAt: Date | null): string {
  if (reasons.includes('YAD_DNC') || reasons.includes('ACCOUNT_SUPPRESSED')) {
    return 'This company asked not to be contacted.';
  }
  if (reasons.includes('ENDPOINT_SUPPRESSED')) return 'This number is suppressed.';
  if (reasons.includes('WRONG_NUMBER')) return 'Marked wrong number.';
  if (reasons.includes('REGISTRY_RESTRICTED')) return 'Calling restrictions apply — manager review needed.';
  if (reasons.includes('REGISTRY_SCREEN_FAILED')) return 'Screening did not complete. Try again shortly.';
  if (reasons.includes('OUTSIDE_CALLING_WINDOW')) {
    return nextEligibleAt
      ? `Outside local calling hours — callable from ${formatDateTime(nextEligibleAt)}.`
      : 'Outside local calling hours.';
  }
  if (reasons.includes('ATTEMPT_COOLDOWN')) {
    return nextEligibleAt
      ? `Attempted recently — next attempt from ${formatDateTime(nextEligibleAt)}.`
      : 'Attempted too recently.';
  }
  if (reasons.includes('PERSONAL_MOBILE')) return 'Looks like a personal mobile — review before calling.';
  if (reasons.includes('REGISTRY_NOT_SCREENED') || reasons.includes('LINE_TYPE_UNKNOWN')) {
    return 'Screening pending — not cleared to call yet.';
  }
  return 'Not cleared to call.';
}

const ROLE_CONFIDENCE_LABEL: Record<string, { text: string; tone: string }> = {
  CONFIRMED_CURRENT_ROLE: { text: 'Role confirmed current', tone: 'badge-good' },
  LIKELY_CURRENT_ROLE: { text: 'Role likely current', tone: '' },
  HISTORICAL_ROLE: { text: 'Historical role — may have moved on', tone: 'badge-warn' },
  ROLE_ONLY_TARGET: { text: 'Target role — person not verified', tone: 'badge-warn' },
  UNKNOWN_ROLE: { text: 'Role unverified', tone: 'badge-warn' },
};

function endpointRow(endpoint: DetailEndpoint, contactName: string | null): RawHtml {
  const { label, tone } = endpointLabel(endpoint);
  const toneClass = tone === 'good' ? 'badge-good' : tone === 'warn' ? 'badge-warn'
    : tone === 'bad' ? 'badge-bad' : '';
  const dead = tone === 'bad';
  const isPhone = endpoint.endpoint_type === 'PHONE';

  // A company main line is never presented as the person's direct line. When the
  // route goes through the front desk, the rep is told who to ask for.
  const routeNote =
    isPhone && contactName && endpoint.relationship_to_person === 'COMPANY_ROUTE'
      ? html`<div class="micro" style="color:#B45309;margin-top:2px">Main line — ask for ${contactName}</div>`
      : '';

  // Phone eligibility is a separate axis from endpoint quality. A perfectly good
  // number may still be blocked, and a rep must not be able to tap or copy it
  // (global-phone-channel-eligibility-dnc-spec §19 hard fail).
  const humanDecision = isPhone ? (endpoint.human_manual_call ?? 'REVIEW_REQUIRED') : 'ALLOW';
  const aiDecision = isPhone ? (endpoint.autonomous_ai_voice ?? 'BLOCK') : 'NOT_APPLICABLE';
  const callable = !dead && (!isPhone || humanDecision === 'ALLOW');

  const eligibilityBadge = isPhone ? html`
    <span class="badge ${
      humanDecision === 'ALLOW' ? 'badge-good'
      : humanDecision === 'BLOCK' ? 'badge-bad' : 'badge-warn'
    }">${
      humanDecision === 'ALLOW' ? 'Human call allowed'
      : humanDecision === 'BLOCK' ? 'Do not call' : 'Review required'
    }</span>
    ${aiDecision === 'ALLOW'
      ? html`<span class="badge badge-good">AI voice allowed</span>`
      : html`<span class="badge">AI voice off</span>`}` : '';

  const eligibilityNote = isPhone && humanDecision !== 'ALLOW'
    ? html`<div class="micro" style="color:var(--crimson);margin-top:3px">${
        explainEligibility(endpoint.eligibility_reason_codes ?? [], endpoint.next_human_eligible_at)
      }</div>`
    : '';

  return html`
  <div class="endpoint">
    <div style="flex:1;min-width:0">
      <div class="endpoint-value" style="${raw(dead || !callable ? 'text-decoration:line-through;color:var(--slate-gray)' : '')}">
        ${endpoint.display_value}${endpoint.extension ? html` <span class="muted small">ext. ${endpoint.extension}</span>` : ''}
      </div>
      <div class="endpoint-meta">
        <span class="badge ${toneClass}">${endpointRoleLabel(endpoint.endpoint_role)}</span>
        <span> ${label}</span>
        ${endpoint.observed_at ? html`<span> · seen ${relativeTime(endpoint.observed_at)}</span>` : ''}
      </div>
      <div class="row" style="gap:5px;margin-top:4px">${eligibilityBadge}</div>
      ${eligibilityNote}
      ${routeNote}
    </div>
    ${!callable ? '' : html`
    <div class="row" style="gap:6px">
      ${isPhone
        ? html`<a class="btn btn-secondary btn-sm js-start-call" href="tel:${endpoint.normalized_value}"
                  data-endpoint="${endpoint.endpoint_id}">Call</a>`
        : html`<a class="btn btn-secondary btn-sm" href="mailto:${endpoint.normalized_value}">Email</a>`}
      <button class="btn btn-ghost btn-sm js-copy" type="button" data-value="${endpoint.display_value}">Copy</button>
    </div>`}
  </div>`;
}

function contactBlock(contact: DetailContact, isPrimary: boolean): RawHtml {
  const confidence = ROLE_CONFIDENCE_LABEL[contact.role_confidence] ?? ROLE_CONFIDENCE_LABEL['UNKNOWN_ROLE']!;

  if (contact.is_role_placeholder || !contact.full_name) {
    // A role route is a valid, sales-ready record — not a product failure
    // (public-decision-maker-resolution-spec §18).
    return html`
    <div class="contact-block">
      <div class="contact-name">Target role: ${titleCase(contact.role_category)}</div>
      <div class="contact-title">Named person not verified — ask who oversees this</div>
      ${contact.endpoints.map((endpoint) => endpointRow(endpoint, null))}
    </div>`;
  }

  return html`
  <div class="contact-block">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div>
        <div class="contact-name">${contact.full_name}</div>
        <div class="contact-title">${contact.raw_title ?? titleCase(contact.role_category)}</div>
      </div>
      ${isPrimary ? html`<span class="badge badge-tier-A">Best contact</span>` : ''}
    </div>
    <div class="row micro" style="margin-top:6px;gap:6px">
      <span class="badge ${confidence.tone}">${confidence.text}</span>
      ${contact.company_relationship === 'registered_agent'
        ? html`<span class="badge badge-warn">Registered agent — not a sales role</span>` : ''}
      ${contact.company_relationship === 'license_qualifier'
        ? html`<span class="badge badge-warn">License qualifier — may not run operations</span>` : ''}
      ${contact.source_reference
        ? html`<a class="micro" href="${contact.source_reference}" target="_blank" rel="noreferrer noopener">source</a>` : ''}
    </div>
    ${contact.endpoints.map((endpoint) => endpointRow(endpoint, contact.full_name))}
  </div>`;
}

export function renderAccountBody(detail: AccountDetail, user: SessionUser): RawHtml {
  const { account, contacts, accountEndpoints, hypotheses, evidence, timeline, followUps } = detail;
  const primaryHypothesis = hypotheses[0];
  const currentEvidence = evidence.filter((item) => !item.is_expired);
  const staleEvidence = evidence.filter((item) => item.is_expired);

  return html`
  <div class="section">
    <h3>Contact</h3>
    ${contacts.length === 0 && accountEndpoints.length === 0
      ? html`<div class="callout callout-warn">
          <h4>No usable contact yet</h4>
          <p style="margin:0">We have the company but no reliable contact endpoint.</p>
          ${detail.canWork ? html`<form method="post" action="/accounts/${account.account_id}/contact-research" style="margin-top:10px">
            <button class="btn btn-secondary btn-sm" type="submit">Request contact research</button>
          </form>` : ''}
        </div>`
      : html`
        ${contacts.map((contact, index) => contactBlock(contact, index === 0))}
        ${accountEndpoints.length > 0 ? html`
          <div class="contact-block">
            <div class="contact-name" style="font-size:0.9rem">Company endpoints</div>
            <div class="contact-title">Not tied to a named person</div>
            ${accountEndpoints.map((endpoint) => endpointRow(endpoint, contacts[0]?.full_name ?? null))}
          </div>` : ''}`}
  </div>

  <div class="section">
    <h3>Why reach out</h3>
    <div class="callout callout-hypothesis">
      ${primaryHypothesis
        ? html`<h4>Hypothesis — ${titleCase(primaryHypothesis.category)}</h4>
               <p style="margin:0">${primaryHypothesis.hypothesis_text}</p>
               <p class="micro muted" style="margin:8px 0 0">
                 This is a hypothesis to test on the call, not a fact about their business.
               </p>`
        : html`<p style="margin:0" class="muted">No opportunity hypothesis has been generated yet.</p>`}
    </div>
    ${detail.suggestedFirstQuestion ? html`
    <div class="callout callout-question" style="margin-top:10px">
      <h4>Suggested first question</h4>
      <p style="margin:0">“${detail.suggestedFirstQuestion}”</p>
    </div>` : ''}
  </div>

  ${isManager(user.role) ? html`
  <div class="section">
    <h3>Sales AI pilot</h3>
    <p class="muted small">
      Adding this company queues it for operator review on the
      <a href="/ai/pilot">pilot page</a>. It does not dial, and it does not schedule anything.
    </p>
    <form method="post" action="/ai/pilot/candidates">
      <input type="hidden" name="accountId" value="${account.account_id}">
      <button type="submit" class="btn btn-secondary btn-sm">Add to the pilot list</button>
    </form>
  </div>` : ''}

  <div class="section">
    <h3>Do not claim</h3>
    <div class="callout callout-warn">
      <ul style="margin:0;padding-left:18px">
        ${detail.prohibitedClaims.map((claim) => html`<li>${claim}</li>`)}
      </ul>
    </div>
  </div>

  <div class="section">
    <h3>Signals</h3>
    ${currentEvidence.length === 0 && staleEvidence.length === 0
      ? html`<p class="muted small">No research evidence recorded yet.</p>`
      : html`
        <div class="row" style="gap:6px">
          ${currentEvidence.map((item) => html`
            <span class="badge ${item.can_state_as_fact ? 'badge-good' : ''}"
                  title="${item.claim_text} — ${item.source_type}, seen ${relativeTime(item.observed_at)}">
              ${titleCase(item.claim_key)}
            </span>`)}
          ${staleEvidence.map((item) => html`
            <span class="badge badge-stale"
                  title="Expired ${relativeTime(item.expires_at)} — do not state in present tense">
              ${titleCase(item.claim_key)} (stale)
            </span>`)}
        </div>
        <p class="micro muted" style="margin-top:8px">
          Solid badges are confirmed and safe to reference. Dashed badges have aged past their
          freshness window — refresh before saying "currently".
        </p>`}
  </div>

  ${followUps.length > 0 ? html`
  <div class="section">
    <h3>Open follow-ups</h3>
    ${followUps.map((followUp) => html`
      <div class="callout" style="margin-bottom:8px">
        <strong>${titleCase(followUp.followup_type)}</strong> · ${formatDateTime(followUp.due_at)}
        ${followUp.prospect_requested ? html`<span class="badge badge-warn" style="margin-left:6px">They asked for this</span>` : ''}
        ${followUp.context ? html`<div class="muted small" style="margin-top:4px">${followUp.context}</div>` : ''}
      </div>`)}
  </div>` : ''}

  <div class="section">
    <h3>Shared history</h3>
    ${timeline.length === 0
      ? html`<p class="muted small">Nothing has happened with this company yet.</p>`
      : html`<ul class="timeline">
          ${timeline.map((event) => html`
            <li>
              <div style="flex:1">
                <div class="timeline-type">${titleCase(event.disposition ?? event.activity_type)}</div>
                ${event.notes ? html`<div class="muted small">${event.notes}</div>` : ''}
                ${event.actor_name ? html`<div class="micro muted">${event.actor_name}</div>` : ''}
              </div>
              <span class="timeline-when">${relativeTime(event.occurred_at)}</span>
            </li>`)}
        </ul>`}
  </div>`;
}

/** Drawer body: the head block is lifted into the sticky drawer header by portal.js. */
export function renderAccountPanel(detail: AccountDetail, user: SessionUser): string {
  const { account } = detail;
  return html`
  <div data-drawer-head>
    <div class="row" style="gap:8px">
      ${tierBadge(account.manual_tier, account.manual_score)}
      ${channelBadge(account.channel_state)}
      ${account.current_owner_user_id === user.userId
        ? html`<span class="badge badge-owner-you">You own this</span>`
        : account.current_owner_user_id
          ? html`<span class="badge">Owned by ${account.owner_display_name}</span>`
          : html`<span class="badge">Unclaimed</span>`}
    </div>
    <h2 style="margin-top:8px">${account.company_name}</h2>
    <div class="muted small">${account.geography_summary}${
      account.canonical_domain ? html` · <a href="https://${account.canonical_domain}" target="_blank" rel="noreferrer noopener">${account.canonical_domain}</a>` : ''
    }</div>
    <div class="row" style="margin-top:12px;gap:8px">
      <a class="btn btn-primary btn-sm" href="/accounts/${account.account_id}">Open full account</a>
      ${!account.current_owner_user_id && !account.is_suppressed
        ? html`<button class="btn btn-secondary btn-sm js-claim" data-account="${account.account_id}">Claim to Me</button>`
        : ''}
    </div>
  </div>
  ${renderAccountBody(detail, user)}`.value;
}

const DISPOSITIONS: { value: string; label: string }[] = [
  { value: 'NO_ANSWER', label: 'No answer' },
  { value: 'VOICEMAIL', label: 'Voicemail' },
  { value: 'GATEKEEPER', label: 'Gatekeeper' },
  { value: 'DECISION_MAKER_REACHED', label: 'Decision maker reached' },
  { value: 'SEND_INFORMATION', label: 'Send information' },
  { value: 'CALLBACK_REQUESTED', label: 'Callback requested' },
  { value: 'POSSIBLE_OPPORTUNITY', label: 'Possible opportunity' },
  { value: 'MEETING_SCHEDULED', label: 'Meeting scheduled' },
  { value: 'NOT_A_FIT', label: 'Not a fit' },
  { value: 'WRONG_NUMBER', label: 'Wrong number' },
  { value: 'DO_NOT_CONTACT', label: 'Do not contact' },
];

export function renderAccountPage(
  detail: AccountDetail, user: SessionUser, counts: NavCounts, flash?: string,
): string {
  const { account } = detail;
  const phoneEndpoints = [
    ...detail.accountEndpoints,
    ...detail.contacts.flatMap((contact) => contact.endpoints),
  ].filter((endpoint) => endpoint.endpoint_type === 'PHONE' && endpoint.is_active);

  const dispositionForm = detail.canWork ? html`
  <div class="card">
    <div class="card-head"><h2>Log an outcome</h2></div>
    <form class="card-pad js-disposition-form" method="post" action="/accounts/${account.account_id}/disposition">
      <div class="field" style="margin-bottom:12px">
        <label for="disposition">What happened?</label>
        <select id="disposition" name="disposition" required>
          ${DISPOSITIONS.map((item) => html`<option value="${item.value}">${item.label}</option>`)}
        </select>
      </div>

      <div class="field" data-when="CALLBACK_REQUESTED" hidden style="margin-bottom:12px">
        <label for="callbackDueAt">Call back at</label>
        <input id="callbackDueAt" name="callbackDueAt" type="datetime-local">
        <span class="micro muted">A requested callback protects this account from release.</span>
      </div>

      <div class="field" data-when="WRONG_NUMBER" hidden style="margin-bottom:12px">
        <label for="endpointId">Which number was wrong?</label>
        <select id="endpointId" name="endpointId">
          <option value="">Select a number</option>
          ${phoneEndpoints.map((endpoint) => html`
            <option value="${endpoint.endpoint_id}">${endpoint.display_value} — ${endpointRoleLabel(endpoint.endpoint_role)}</option>`)}
        </select>
        <span class="micro muted">Only this number is marked bad. The company stays a prospect.</span>
      </div>

      <div class="callout callout-danger" data-when="DO_NOT_CONTACT" hidden style="margin-bottom:12px">
        <h4>This is permanent</h4>
        <p style="margin:0">Do Not Contact suppresses this company across every channel and removes it from
        inventory. You will not be able to undo it yourself.</p>
      </div>

      <div class="field" style="margin-bottom:12px">
        <label for="notes">Notes — record what they actually said</label>
        <textarea id="notes" name="notes" placeholder="Their words, not a paraphrase."></textarea>
      </div>

      <button class="btn btn-primary" type="submit">Save outcome</button>
    </form>
  </div>` : html`
  <div class="card card-pad">
    <p class="muted small" style="margin:0">
      ${account.current_owner_user_id
        ? `${account.owner_display_name} owns this account. Ask them or a manager before contacting the company.`
        : 'Claim this account before logging sales activity against it.'}
    </p>
  </div>`;

  // Booking panel. Times are fetched live from the calendar when the rep opens the
  // panel — never rendered from a fixed schedule, because an offered time the
  // calendar has not confirmed is a promise we cannot keep.
  const bookingCard = detail.canWork ? html`
  <div class="card">
    <div class="card-head"><h2>Book a strategy call</h2></div>
    <div class="card-pad">
      <p class="muted small" style="margin:0 0 10px">
        Times come from Michael's live calendar. Nothing is booked until he confirms it.
      </p>
      <button class="btn btn-secondary btn-sm" type="button" id="js-load-slots">Check availability</button>
      <div id="slot-area" style="margin-top:12px"></div>
      <form method="post" action="/accounts/${account.account_id}/book" id="booking-form" hidden
            style="margin-top:12px">
        <input type="hidden" name="start" id="booking-start">
        <input type="hidden" name="end" id="booking-end">
        <input type="hidden" name="slotToken" id="booking-token">
        <div class="field" style="margin-bottom:10px">
          <label for="attendeeName">Their name</label>
          <input id="attendeeName" name="attendeeName" type="text"
                 value="${detail.contacts[0]?.full_name ?? ''}">
        </div>
        <div class="field" style="margin-bottom:10px">
          <label for="attendeeEmail">Their email — the invite goes here</label>
          <input id="attendeeEmail" name="attendeeEmail" type="email">
        </div>
        <div class="field" style="margin-bottom:10px">
          <label for="attendeePhone">Their phone</label>
          <input id="attendeePhone" name="attendeePhone" type="text">
        </div>
        <div class="field" style="margin-bottom:10px">
          <label for="agendaNote">What they actually said the problem is</label>
          <textarea id="agendaNote" name="agendaNote"
                    placeholder="Their words. This goes on the invite so Michael doesn't ask again."></textarea>
        </div>
        <label class="row micro" style="gap:8px;margin-bottom:12px;align-items:flex-start">
          <input type="checkbox" name="prospectAgreed" value="on" required>
          <span>They agreed to this specific time on the call.</span>
        </label>
        <button class="btn btn-primary btn-sm" type="submit">Book it</button>
      </form>
    </div>
  </div>` : raw('');

  const ownershipCard = html`
  <div class="card">
    <div class="card-head"><h2>Ownership</h2></div>
    <div class="card-pad">
      <p style="margin:0 0 10px">
        ${account.current_owner_user_id
          ? html`Owned by <strong>${account.current_owner_user_id === user.userId ? 'you' : account.owner_display_name}</strong>
                 ${account.claimed_at ? html`since ${relativeTime(account.claimed_at)}` : ''}`
          : account.is_suppressed
            ? html`<span class="badge badge-bad">Suppressed</span> This company cannot be worked.`
            : 'Unclaimed.'}
      </p>
      <div class="row">
        ${!account.current_owner_user_id && !account.is_suppressed
          ? html`<button class="btn btn-primary btn-sm js-claim" data-account="${account.account_id}">Claim to Me</button>` : ''}
        ${account.current_owner_user_id === user.userId
          ? html`<form method="post" action="/accounts/${account.account_id}/release">
                   <button class="btn btn-secondary btn-sm" type="submit">Release</button>
                 </form>` : ''}
      </div>
      ${detail.ownershipEvents.length > 0 ? html`
      <ul class="timeline" style="margin-top:12px">
        ${detail.ownershipEvents.slice(0, 5).map((event: any) => html`
          <li>
            <div style="flex:1">
              <div class="timeline-type">${titleCase(event.event_type)}</div>
              <div class="micro muted">
                ${event.new_owner_name ? `to ${event.new_owner_name}` : ''}
                ${event.previous_owner_name ? ` (from ${event.previous_owner_name})` : ''}
                ${event.reason ? ` — ${event.reason}` : ''}
              </div>
            </div>
            <span class="timeline-when">${relativeTime(event.occurred_at)}</span>
          </li>`)}
      </ul>` : ''}
    </div>
  </div>`;

  const body = html`
    ${flash ? html`<div class="coverage-note info" style="margin-bottom:16px">${flash}</div>` : ''}
    ${account.is_suppressed ? html`
      <div class="callout callout-danger" style="margin-bottom:16px">
        <h4>Suppressed — do not contact</h4>
        <p style="margin:0">${account.suppression_summary ?? 'This company is on the suppression list.'}
        Only an administrator can lift this.</p>
      </div>` : ''}
    <div class="grid" style="grid-template-columns:minmax(0,1.55fr) minmax(300px,1fr);align-items:start">
      <div class="stack">
        <div class="card card-pad">${renderAccountBody(detail, user)}</div>
      </div>
      <div class="stack">
        ${dispositionForm}
        ${bookingCard}
        ${ownershipCard}
      </div>
    </div>`;

  return renderPage({
    title: account.company_name,
    subtitle: html`${account.geography_summary}${
      account.canonical_domain
        ? html` · <a href="https://${account.canonical_domain}" target="_blank" rel="noreferrer noopener">${account.canonical_domain}</a>`
        : ''}`,
    user, currentPath: '/prospects', counts, body,
    actions: html`${tierBadge(account.manual_tier, account.manual_score)} ${adBadges(account)} ${channelBadge(account.channel_state)}`,
    script: html`
(function () {
  var button = document.getElementById('js-load-slots');
  if (!button) return;
  var area = document.getElementById('slot-area');
  var form = document.getElementById('booking-form');

  button.addEventListener('click', function () {
    button.disabled = true;
    button.textContent = 'Checking…';
    fetch('/api/booking/availability', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (offer) {
        button.disabled = false;
        button.textContent = 'Check availability';
        area.innerHTML = '';

        if (!offer.slots || offer.slots.length === 0) {
          // No invented times. Show exactly what may be said instead.
          var warn = document.createElement('div');
          warn.className = 'callout callout-warn';
          warn.textContent = offer.message || 'No times are available to offer right now.';
          area.appendChild(warn);
          form.hidden = true;
          return;
        }

        var hint = document.createElement('p');
        hint.className = 'micro muted';
        hint.style.margin = '0 0 8px';
        hint.textContent = offer.sameDay
          ? 'Same-day availability on ' + offer.calendarUpn
          : 'Next available on ' + offer.calendarUpn;
        area.appendChild(hint);

        offer.slots.forEach(function (slot) {
          var chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chip';
          chip.style.marginRight = '8px';
          chip.textContent = slot.spoken;
          chip.addEventListener('click', function () {
            area.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
            chip.setAttribute('aria-pressed', 'true');
            document.getElementById('booking-start').value = slot.start;
            document.getElementById('booking-end').value = slot.end;
            document.getElementById('booking-token').value = slot.token;
            form.hidden = false;
          });
          area.appendChild(chip);
        });
      })
      .catch(function () {
        button.disabled = false;
        button.textContent = 'Check availability';
        area.innerHTML = '<div class="callout callout-warn">Could not reach the calendar.</div>';
      });
  });
})();`,
  });
}

export { isManager };
