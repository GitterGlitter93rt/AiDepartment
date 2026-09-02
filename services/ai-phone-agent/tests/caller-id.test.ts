// Using the number Twilio already gave us.
//
// The behaviour this replaces: asking somebody stranded on a bridge to
// recite the phone number we are literally receiving their call on.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isUsableNumber, resolveSmsRecipient, resolveCallbackRecipient, renderPhoneGuidance,
} from '../src/core/contact-routing.ts';
import { speakPhone, spellPhoneDigits } from '../src/core/speech.ts';
import { validateToolRequest, executeToolRequest } from '../src/core/tool-protocol.ts';
import { Orchestrator } from '../src/core/orchestrator.ts';
import { SessionStore } from '../src/core/session.ts';
import { createRecordingClaudeClient } from '../src/claude/client.ts';
import { createLogger } from '../src/logger.ts';
import { createMockToolbox } from '../src/tools/index.ts';
import { packetById } from '../src/business/policies.ts';
import type { Session } from '../src/core/types.ts';

const silent = createLogger({}, () => {});
const REAL = '+19045551234';
const OTHER = '+19045559999';

function session(from = REAL, industry = 'collision_repair'): Session {
  const store = new SessionStore();
  const s = store.ensure('CA_cid', from, '+19045550100');
  store.setRoute('CA_cid', {
    industry: industry as never, specialty: 'general', intent: 'accident_repair',
    urgency: 'high', confidence: 0.9, source: 'heuristic',
  });
  return s;
}

describe('What counts as a usable caller ID', () => {
  test('a real number does', () => {
    for (const n of [REAL, '9045551234', '+442071234567']) assert.equal(isUsableNumber(n), true, n);
  });

  test('the ways Twilio says "no caller ID" do not', () => {
    for (const n of ['unknown', 'anonymous', 'private', 'restricted', 'blocked', 'unavailable', '', '   ', undefined]) {
      assert.equal(isUsableNumber(n as string), false, JSON.stringify(n));
    }
  });

  test('malformed values do not', () => {
    for (const n of ['555', 'abc', '+', '0123', '12345678901234567890']) {
      assert.equal(isUsableNumber(n), false, n);
    }
  });
});

describe('Caller ID seeds a PROVISIONAL number', () => {
  test('a valid From is stored, sourced and marked unconfirmed', async () => {
    const sessions = new SessionStore();
    sessions.ensure('CA_a', REAL, '+19045550100');
    const orch = new Orchestrator({ sessions, claude: null, log: silent });
    await orch.handleCallerUtterance('CA_a', 'I just got into a car accident on the Buckman Bridge.');

    const c = sessions.get('CA_a')!.contact;
    assert.equal(c.phone, REAL);
    assert.equal(c.phoneSource, 'caller_id');
    assert.equal(c.phoneConfirmed, false, 'Twilio told us; the caller has not');
  });

  test('an anonymous From stores nothing', async () => {
    const sessions = new SessionStore();
    sessions.ensure('CA_b', 'anonymous', '+19045550100');
    const orch = new Orchestrator({ sessions, claude: null, log: silent });
    await orch.handleCallerUtterance('CA_b', 'I just got into a car accident on the Buckman Bridge.');
    assert.equal(sessions.get('CA_b')!.contact.phone, undefined);
  });

  test('a malformed From stores nothing', async () => {
    const sessions = new SessionStore();
    sessions.ensure('CA_c', '555', '+19045550100');
    const orch = new Orchestrator({ sessions, claude: null, log: silent });
    await orch.handleCallerUtterance('CA_c', 'I just got into a car accident on the Buckman Bridge.');
    assert.equal(sessions.get('CA_c')!.contact.phone, undefined);
  });

  test('only the provenance is logged, never the number', async () => {
    const lines: string[] = [];
    const log = createLogger({}, (l) => lines.push(l));
    const sessions = new SessionStore();
    sessions.ensure('CA_d', REAL, '+19045550100');
    await new Orchestrator({ sessions, claude: null, log }).handleCallerUtterance('CA_d', 'My roof is leaking after the storm.');

    const all = lines.join('\n');
    assert.match(all, /"source":"caller_id"/);
    assert.doesNotMatch(all, /9045551234/, 'the number itself must not be logged');
  });
});

describe('The agent confirms rather than asking', () => {
  test('the prompt says confirm, not ask, and gives the wording', () => {
    const s = session();
    s.contact = { phone: REAL, phoneSource: 'caller_id', phoneConfirmed: false };
    const block = renderPhoneGuidance(s, 'collision_repair')!;

    assert.match(block, /CONFIRM IT, DO NOT ASK FOR IT/);
    assert.match(block, /Never ask "what's your phone number\?"/);
    assert.match(block, /\(904\) 555-1234/, 'spoken form, not E.164');
    assert.doesNotMatch(block, /\+19045551234/, 'the stored form is never read out');
    assert.match(block, /tow driver|driver and the shop/i, 'wording fits the trade');
  });

  test('each trade gets wording that explains why the number matters', () => {
    const s = session();
    s.contact = { phone: REAL, phoneSource: 'caller_id', phoneConfirmed: false };
    assert.match(renderPhoneGuidance(s, 'attorneys')!, /attorney call you back/i);
    assert.match(renderPhoneGuidance(s, 'plumbing')!, /technician/i);
    assert.match(renderPhoneGuidance(s, null)!, /best number to reach you/i);
  });

  test('with no caller ID it asks properly instead', () => {
    const s = session('anonymous');
    const block = renderPhoneGuidance(s, 'collision_repair')!;
    assert.match(block, /did not come through/i);
    assert.match(block, /Ask for the best one/i);
    assert.doesNotMatch(block, /CONFIRM IT, DO NOT ASK/);
  });

  test('once confirmed it stops asking', () => {
    const s = session();
    s.contact = { phone: REAL, phoneSource: 'caller_id', phoneConfirmed: true };
    const block = renderPhoneGuidance(s, 'collision_repair')!;
    assert.match(block, /ALREADY CONFIRMED/);
    assert.match(block, /Do not ask again/i);
    assert.match(block, /text that to the same number/i, 'later sends reuse it');
  });

  test('a "do not text me" is surfaced once confirmed', () => {
    const s = session();
    s.contact = { phone: REAL, phoneConfirmed: true, smsAllowed: false };
    assert.match(renderPhoneGuidance(s, 'collision_repair')!, /asked NOT to be texted/i);
  });
});

describe('Confirming and replacing the number', () => {
  test('capture_details marks it confirmed without changing it', async () => {
    const s = session();
    s.contact = { phone: REAL, phoneSource: 'caller_id', phoneConfirmed: false };
    await executeToolRequest(
      { id: '1', name: 'capture_details', input: { phoneConfirmed: true } },
      { tools: createMockToolbox(), log: silent, session: s },
    );
    assert.equal(s.contact.phone, REAL, 'unchanged');
    assert.equal(s.contact.phoneConfirmed, true);
  });

  test('a number they give replaces the provisional one and arrives confirmed', async () => {
    const s = session();
    s.contact = { phone: REAL, phoneSource: 'caller_id', phoneConfirmed: false };
    await executeToolRequest(
      { id: '1', name: 'capture_details', input: { phone: OTHER } },
      { tools: createMockToolbox(), log: silent, session: s },
    );
    assert.equal(s.contact.phone, OTHER);
    assert.equal(s.contact.phoneSource, 'caller_provided');
    assert.equal(s.contact.phoneConfirmed, true, 'they said it out loud');
  });

  test('a spoken number is picked up and marked confirmed', async () => {
    const sessions = new SessionStore();
    sessions.ensure('CA_e', REAL, '+19045550100');
    const orch = new Orchestrator({ sessions, claude: null, log: silent });
    await orch.handleCallerUtterance('CA_e', 'I just got into a car accident on the Buckman Bridge.');
    await orch.handleCallerUtterance('CA_e', 'Actually call me on 904-555-9999 instead.');

    const c = sessions.get('CA_e')!.contact;
    assert.equal(c.phone, OTHER);
    assert.equal(c.phoneSource, 'caller_provided');
    assert.equal(c.phoneConfirmed, true);
  });

  test('a separate texting number is validated', async () => {
    const s = session();
    const v = validateToolRequest({ id: '1', name: 'capture_details', input: { smsPhone: '555' } }, s);
    assert.equal(v.ok, false);
    assert.match(v.reason!, /texting number does not look right/i);
  });

  test('the canonical stored value stays E.164', async () => {
    const s = session();
    await executeToolRequest(
      { id: '1', name: 'capture_details', input: { phone: OTHER } },
      { tools: createMockToolbox(), log: silent, session: s },
    );
    assert.match(s.contact.phone!, /^\+1\d{10}$/);
    // And is spoken differently from how it is stored.
    assert.equal(speakPhone(s.contact.phone!), '(904) 555-9999');
  });
});

describe('SMS recipients resolve in one place', () => {
  test('a confirmed number is used', () => {
    const s = session();
    s.contact = { phone: REAL, phoneConfirmed: true };
    const r = resolveSmsRecipient(s);
    assert.equal(r.phone, REAL);
    assert.equal(r.confirmed, true);
  });

  test('an unconfirmed caller ID comes back unconfirmed, with the wording to ask', () => {
    const s = session();
    s.contact = { phone: REAL, phoneSource: 'caller_id', phoneConfirmed: false };
    const r = resolveSmsRecipient(s);
    assert.equal(r.phone, REAL);
    assert.equal(r.confirmed, false);
    assert.match(r.reason!, /Is \(904\) 555-1234 okay to text/);
  });

  test('a nominated texting number wins', () => {
    const s = session();
    s.contact = { phone: REAL, phoneConfirmed: true, smsPhone: OTHER };
    assert.equal(resolveSmsRecipient(s).phone, OTHER);
  });

  test('"do not text me" blocks it entirely', () => {
    const s = session();
    s.contact = { phone: REAL, phoneConfirmed: true, smsAllowed: false };
    const r = resolveSmsRecipient(s);
    assert.equal(r.phone, null);
    assert.match(r.reason!, /asked not to be texted/i);
  });

  test('a callback ignores the separate texting number', () => {
    // Somebody who wants links on their mobile still wants the
    // technician to ring the number they called on.
    const s = session();
    s.contact = { phone: REAL, phoneConfirmed: true, smsPhone: OTHER };
    assert.equal(resolveCallbackRecipient(s).phone, REAL);
  });
});

describe('Every SMS action uses the confirmed number', () => {
  const unconfirmed = (): Session => {
    const s = session();
    s.contact = { firstName: 'Michael', phone: REAL, phoneSource: 'caller_id', phoneConfirmed: false };
    return s;
  };
  const confirmed = (extra: Record<string, unknown> = {}): Session => {
    const s = session();
    s.contact = { firstName: 'Michael', phone: REAL, phoneConfirmed: true };
    Object.assign(s.qualification, extra);
    return s;
  };

  test('the location link asks before the first text', () => {
    const v = validateToolRequest({ id: '1', name: 'create_location_link', input: {} }, unconfirmed());
    assert.equal(v.ok, false);
    assert.match(v.reason!, /okay to text/i);
  });

  test('and goes through once confirmed', () => {
    const v = validateToolRequest({ id: '1', name: 'create_location_link', input: {} }, confirmed());
    assert.equal(v.ok, true);
    assert.equal(v.value!.phone, REAL);
  });

  test('the upload link follows the same rule', () => {
    assert.equal(validateToolRequest({ id: '1', name: 'create_upload_link', input: { purposeId: 'collision_damage_photos', callerIsSafe: true } }, unconfirmed()).ok, false);
    assert.equal(validateToolRequest({ id: '1', name: 'create_upload_link', input: { purposeId: 'collision_damage_photos', callerIsSafe: true } }, confirmed()).ok, true);
  });

  test('e-sign by SMS follows the same rule, and email is unaffected', () => {
    const ready = { vehicleMake: 'BMW', vehicleModel: 'X5', repairIntentConfirmed: true };
    const bySms = { packetId: 'collision_repair_intake', deliveryChannel: 'sms', consentConfirmed: true };
    assert.equal(validateToolRequest({ id: '1', name: 'send_esign_packet', input: bySms }, Object.assign(unconfirmed(), { qualification: ready })).ok, false);
    assert.equal(validateToolRequest({ id: '1', name: 'send_esign_packet', input: bySms }, confirmed(ready)).ok, true);

    // Email does not need a texting confirmation.
    const s = unconfirmed();
    Object.assign(s.qualification, ready);
    s.contact.email = 'michael@example.com';
    assert.equal(validateToolRequest({ id: '1', name: 'send_esign_packet', input: { packetId: 'collision_repair_intake', deliveryChannel: 'email', consentConfirmed: true } }, s).ok, true);
  });

  test('a nominated texting number is what actually gets used', () => {
    const s = confirmed();
    s.contact.smsPhone = OTHER;
    assert.equal(validateToolRequest({ id: '1', name: 'create_location_link', input: {} }, s).value!.phone, OTHER);
  });

  test('the model still cannot name a recipient', async () => {
    const { TOOL_SCHEMAS } = await import('../src/core/tool-protocol.ts');
    for (const name of ['create_location_link', 'create_upload_link']) {
      const schema = TOOL_SCHEMAS.find((t) => t.name === name)!;
      for (const p of Object.keys(schema.input_schema.properties)) {
        assert.doesNotMatch(p, /phone|to\b|recipient|number/i, `${name}.${p} would let the model pick a destination`);
      }
    }
  });

  test('an arbitrary third-party number is still impossible via send_sms', () => {
    const s = confirmed();
    const v = validateToolRequest({ id: '1', name: 'send_sms', input: { to: '+15558675309', body: 'hi' } }, s);
    assert.equal(v.ok, false);
  });
});

describe('The tow callback is a confirmed number', () => {
  const TOW = { callerName: 'Michael', callbackPhone: REAL, vehicleMake: 'BMW', vehicleModel: 'X5', pickupLocation: 'Buckman Bridge shoulder', directionOfTravel: 'northbound' };

  test('dispatch waits for confirmation rather than making them recite it', () => {
    const s = session();
    s.contact = { firstName: 'Michael', phone: REAL, phoneSource: 'caller_id', phoneConfirmed: false };
    s.qualification.towNeeded = true;
    const v = validateToolRequest({ id: '1', name: 'dispatch_tow', input: TOW }, s);
    assert.equal(v.ok, false);
    assert.match(v.reason!, /Confirm|best number/i);
    // And it should tell the agent to check the number it has, not to
    // make a stranded caller read one out.
    assert.match(v.reason!, /number you're calling from|the one you have|best number/i);
  });

  test('and goes through once confirmed', () => {
    const s = session();
    s.contact = { firstName: 'Michael', phone: REAL, phoneConfirmed: true };
    s.qualification.towNeeded = true;
    assert.equal(validateToolRequest({ id: '1', name: 'dispatch_tow', input: TOW }, s).ok, true);
  });
});

describe('The PI packet needs somewhere it happened', () => {
  function pi(qual: Record<string, unknown>): Session {
    const store = new SessionStore();
    const s = store.ensure('CA_pi2', REAL, '+1904');
    store.setRoute('CA_pi2', { industry: 'attorneys', specialty: 'personal_injury', intent: 'car_accident', urgency: 'high', confidence: 0.9, source: 'heuristic' });
    Object.assign(s.contact, { firstName: 'Michael', phone: REAL, phoneConfirmed: true });
    Object.assign(s.qualification, { incidentType: 'rear-ended', incidentDate: '2026-09-01', existingRepresentation: false, ...qual });
    return s;
  }
  const send = (s: Session) => validateToolRequest(
    { id: '1', name: 'send_esign_packet', input: { packetId: 'pi_engagement_packet', deliveryChannel: 'sms', consentConfirmed: true } }, s);

  test('neither location nor accidentLocation is rejected', () => {
    const v = send(pi({}));
    assert.equal(v.ok, false);
    assert.match(v.reason!, /where the incident happened/i);
  });

  test('location alone satisfies it', () => {
    assert.equal(send(pi({ location: 'Jacksonville, FL' })).ok, true);
  });

  test('accidentLocation alone satisfies it', () => {
    // A referral arriving from the collision brain uses the other key.
    assert.equal(send(pi({ accidentLocation: 'Buckman Bridge northbound' })).ok, true);
  });

  test('the requirement is declared as an any-of group', () => {
    assert.deepEqual(packetById('pi_engagement_packet')!.requiresOneOf, [['location', 'accidentLocation']]);
  });

  test('the other requirements still hold', () => {
    assert.equal(send(pi({ location: 'Jacksonville', existingRepresentation: true })).ok, false);
    const noAnswer = pi({ location: 'Jacksonville' });
    delete noAnswer.qualification.existingRepresentation;
    assert.equal(send(noAnswer).ok, false);
    assert.equal(validateToolRequest({ id: '1', name: 'send_esign_packet', input: { packetId: 'pi_engagement_packet', deliveryChannel: 'sms' } }, pi({ location: 'Jacksonville' })).ok, false);
  });
});

describe('Caller ID is the one thing that carries into a YAD prospect', () => {
  test('the number carries over provisionally; the character does not', async () => {
    const sessions = new SessionStore();
    sessions.ensure('CA_yad', REAL, '+19045550100');
    const claude = createRecordingClaudeClient('ok');
    const orch = new Orchestrator({ sessions, claude, log: silent, tools: createMockToolbox() });

    await orch.handleCallerUtterance('CA_yad', 'I just got into a car crash on the Buckman Bridge.');
    sessions.mergeContact('CA_yad', { firstName: 'John', lastName: 'Smith', email: 'john@fake.example', address: '999 Fake Street' });
    await orch.handleCallerUtterance('CA_yad', 'That was great. I own ABC Collision and I want this.');

    const s = sessions.get('CA_yad')!;
    await executeToolRequest(
      { id: '1', name: 'capture_prospect', input: { firstName: 'Mike', companyName: 'ABC Collision' } },
      { tools: createMockToolbox(), log: silent, session: s },
    );

    // Real infrastructure data, carried over and marked provisional.
    assert.equal(s.prospect!.phone, REAL);
    assert.equal(s.prospect!.phoneSource, 'caller_id');
    assert.equal(s.prospect!.phoneConfirmed, false, 'until our team is confirmed as the reason for it');

    // The character does not follow.
    assert.equal(s.prospect!.firstName, 'Mike');
    assert.equal(s.prospect!.email, undefined, 'a fake email must not carry over');
    assert.equal((s.prospect as Record<string, unknown>).address, undefined);
    assert.equal((s.prospect as Record<string, unknown>).lastName, undefined);
  });

  test('confirming it for the discovery call marks it confirmed', async () => {
    const store = new SessionStore();
    const s = store.ensure('CA_yad2', REAL, '+1904');
    await executeToolRequest(
      { id: '1', name: 'capture_prospect', input: { firstName: 'Mike', companyName: 'ABC', phoneConfirmed: true } },
      { tools: createMockToolbox(), log: silent, session: s },
    );
    assert.equal(s.prospect!.phoneConfirmed, true);
    assert.equal(s.prospect!.phone, REAL, 'no need to make them read it out');
  });

  test('the sales prompt asks to confirm rather than to re-enter', async () => {
    const { renderDemoHost } = await import('../src/core/demo-host.ts');
    const block = renderDemoHost('yad_sales', {
      hasRolePlayed: true, scenarioTested: 'collision_repair', ctaOffered: true, ctaDeclined: false, calendarMode: 'mock',
    });
    assert.match(block, /Confirm it rather than making them read it out/i);
    assert.match(block, /number you're calling from/i);
  });
});

describe('Spoken form versus stored form', () => {
  test('the two are different, on purpose', () => {
    const stored = '+19045551234';
    assert.equal(speakPhone(stored), '(904) 555-1234');
    assert.notEqual(speakPhone(stored), stored);
  });

  test('digit-by-digit remains available for dictation', () => {
    assert.equal(spellPhoneDigits('+19045551234'), '9 0 4, 5 5 5, 1 2 3 4');
  });

  test('speech guidance tells the agent never to read the stored form', async () => {
    const { renderSpeechGuidance } = await import('../src/core/speech.ts');
    const g = renderSpeechGuidance({ phone: '+19045551234' })!;
    assert.match(g, /\(904\) 555-1234/);
    assert.match(g, /never the stored \+1 form/i);
  });
});
