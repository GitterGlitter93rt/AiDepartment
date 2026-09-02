// Capturing what the caller actually said.
//
// Real callers do not answer one question at a time. Asked whether
// there are children involved, they say "yeah two, seven and eleven,
// and she took them to her mother's in Jacksonville last week". The
// system has to keep all of that, never ask for it again, and take a
// correction silently.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromUtterance, mergeContact, isCorrection } from '../src/core/extract.ts';
import { validateToolRequest, executeToolRequest } from '../src/core/tool-protocol.ts';
import { Orchestrator } from '../src/core/orchestrator.ts';
import { SessionStore } from '../src/core/session.ts';
import { createLogger } from '../src/logger.ts';
import { buildCallSummary, buildDemoAnalytics } from '../src/core/call-summary.ts';
import { createMockCalendar } from '../src/tools/calendar.ts';
import { createMockSms } from '../src/tools/sms.ts';
import { createTransferTool } from '../src/tools/transfer.ts';
import { createPlaceholderCrm } from '../src/tools/crm.ts';
import type { Toolbox } from '../src/tools/index.ts';
import type { ContactRecord } from '../src/core/types.ts';
import { createMockToolbox } from '../src/tools/index.ts';

const silent = createLogger({}, () => {});
const tools = (): Toolbox => (createMockToolbox());

describe('Phone numbers are caught however they are spoken', () => {
  const SPOKEN: [string, string][] = [
    ['You can reach me at 904-555-0142.', '+19045550142'],
    ['My number is (904) 555-0142.', '+19045550142'],
    ['Call me on 904 555 0142', '+19045550142'],
    ['9045550142 is my cell', '+19045550142'],
    ['my number is 1-904-555-0142', '+19045550142'],
    ['best number for me is 904.555.0142', '+19045550142'],
  ];
  for (const [said, expected] of SPOKEN) {
    test(`"${said.slice(0, 40)}"`, () => {
      assert.equal(extractFromUtterance(said).contact.phone, expected);
    });
  }
});

describe('Digits that are not phone numbers are left alone', () => {
  // A wrong phone number is worse than none: somebody calls it back,
  // gets a stranger, and the real lead never hears from anyone.
  const NOT_PHONES = [
    "I'm at 123 Main Street in St Augustine",
    'The house is 2400 square feet',
    "It's about 15 years old",
    'We need 5,000 units',
    'I have four pallets to move',
    'It was 96 degrees in the house',
    'Apartment 4B, 1200 Ocean Drive',
  ];
  for (const said of NOT_PHONES) {
    test(`"${said.slice(0, 40)}"`, () => {
      assert.equal(extractFromUtterance(said).contact.phone, undefined,
        `wrongly read a phone number out of "${said}"`);
    });
  }

  test('an address WITH a phone number still yields the phone number', () => {
    const r = extractFromUtterance("I'm at 123 Main Street and my number is 904-555-0142");
    assert.equal(r.contact.phone, '+19045550142');
  });
});

describe('Email addresses survive speech-to-text', () => {
  test('a normal address', () => {
    assert.equal(extractFromUtterance('my email is tony@example.com').contact.email, 'tony@example.com');
  });

  test('"at" spelled out, which is how it often arrives', () => {
    assert.equal(extractFromUtterance('tony at example.com').contact.email, 'tony@example.com');
  });

  test('case is normalised', () => {
    assert.equal(extractFromUtterance('Tony.Smith@Example.COM').contact.email, 'tony.smith@example.com');
  });

  test('ordinary speech containing "at" is not an email', () => {
    assert.equal(extractFromUtterance("I'm at work right now").contact.email, undefined);
    assert.equal(extractFromUtterance('It happened at 3 in the morning').contact.email, undefined);
  });
});

describe('ZIP codes are only taken in context', () => {
  test('taken when the sentence is about location', () => {
    assert.equal(extractFromUtterance('my zip is 32084').contact.zip, '32084');
    assert.equal(extractFromUtterance('I live in 32084').contact.zip, '32084');
  });

  test('a bare five-digit number is not a ZIP', () => {
    // Far more often a year, a price, or a part number.
    assert.equal(extractFromUtterance('it was about 32084 of them').contact.zip, undefined);
    assert.equal(extractFromUtterance('the quote was 12000').contact.zip, undefined);
  });
});

describe('The latest correction wins, silently', () => {
  test('a second phone number replaces the first', () => {
    const contact: ContactRecord = {};
    mergeContact(contact, extractFromUtterance('my number is 904-555-1234').contact);
    assert.equal(contact.phone, '+19045551234');

    const second = mergeContact(contact, extractFromUtterance('actually use my other number, 904-555-5678').contact);
    assert.equal(contact.phone, '+19045555678', 'the correction must win');
    assert.deepEqual(second.corrected, ['phone'], 'and be recorded as a correction, not a new capture');
  });

  test('an unchanged value is not reported as a change', () => {
    const contact: ContactRecord = { phone: '+19045550142' };
    const r = mergeContact(contact, { phone: '+19045550142' });
    assert.deepEqual(r.changed, []);
    assert.deepEqual(r.corrected, []);
  });

  test('correction language is recognised', () => {
    for (const said of ['actually, use my cell', 'sorry, I meant 904-555-5678', 'no wait, that is wrong', 'scratch that']) {
      assert.equal(isCorrection(said), true, `not recognised: "${said}"`);
    }
    assert.equal(isCorrection('my number is 904-555-0142'), false);
  });
});

describe('capture_details rejects what it should', () => {
  test('a hallucinated email never reaches the record', () => {
    const v = validateToolRequest(
      { id: '1', name: 'capture_details', input: { email: 'tony at gmail' } },
      new SessionStore().ensure('CA_e'),
    );
    assert.equal(v.ok, false);
    assert.match(v.reason!, /email/i);
  });

  test('a malformed phone number is refused', () => {
    const v = validateToolRequest(
      { id: '1', name: 'capture_details', input: { phone: '555-1234' } },
      new SessionStore().ensure('CA_p'),
    );
    assert.equal(v.ok, false);
  });

  test('an empty call is refused rather than recorded as nothing', () => {
    const v = validateToolRequest(
      { id: '1', name: 'capture_details', input: {} },
      new SessionStore().ensure('CA_z'),
    );
    assert.equal(v.ok, false);
    assert.match(v.reason!, /at least one field/i);
  });

  test('notes must be an object, not a string the model improvised', () => {
    const v = validateToolRequest(
      { id: '1', name: 'capture_details', input: { firstName: 'Tony', notes: 'roof is old' } },
      new SessionStore().ensure('CA_n'),
    );
    assert.equal(v.ok, false);
  });
});

describe('capture_details writes into the session', () => {
  test('fields and notes both land, and the agent is told not to re-ask', async () => {
    const s = new SessionStore().ensure('CA_cap');
    const out = await executeToolRequest(
      {
        id: '1', name: 'capture_details',
        input: {
          firstName: 'Tony', phone: '+19045550142', address: '123 Main Street',
          notes: { minorChildren: 2, childAges: '7 and 11', otherParentLocation: 'Jacksonville' },
        },
      },
      { tools: tools(), log: silent, session: s },
    );
    assert.equal(out.ok, true);
    assert.equal(s.contact.firstName, 'Tony');
    assert.equal(s.contact.phone, '+19045550142');
    assert.equal(s.qualification.minorChildren, 2);
    assert.equal(s.qualification.childAges, '7 and 11');
    assert.match(out.content, /do not ask for any of them again/i);
  });

  test('a later capture overwrites an earlier one', async () => {
    const s = new SessionStore().ensure('CA_ow');
    const run = (phone: string) => executeToolRequest(
      { id: '1', name: 'capture_details', input: { phone } },
      { tools: tools(), log: silent, session: s },
    );
    await run('+19045551234');
    await run('+19045555678');
    assert.equal(s.contact.phone, '+19045555678');
  });

  test('captured values are never logged, only field names', async () => {
    const lines: string[] = [];
    const log = createLogger({}, (l) => lines.push(l));
    const s = new SessionStore().ensure('CA_log');
    await executeToolRequest(
      { id: '1', name: 'capture_details', input: { firstName: 'Tony', phone: '+19045550142', email: 'tony@example.com' } },
      { tools: tools(), log, session: s },
    );
    const all = lines.join('\n');
    assert.match(all, /field.captured/);
    for (const value of ['Tony', '9045550142', 'tony@example.com']) {
      assert.ok(!all.includes(value), `logged a personal value: ${value}`);
    }
  });
});

describe('A caller who volunteers details and never books is not lost', () => {
  // The whole point. Before extraction, this call produced an empty
  // record and an end-of-call summary saying "no contact details
  // captured" — about a caller who had said their number out loud.
  test('details said in passing reach the record and the summary', async () => {
    const sessions = new SessionStore();
    const orch = new Orchestrator({ sessions, claude: null, log: silent });

    await orch.handleCallerUtterance('CA_pass', 'My roof started leaking after the storm.');
    await orch.handleCallerUtterance('CA_pass', "I'm at 412 Oak Street and you can reach me at 904-555-0142.");
    // Caller hangs up here. No booking, no tool call.

    const session = sessions.get('CA_pass')!;
    assert.equal(session.contact.phone, '+19045550142');

    const summary = buildCallSummary(session, []);
    assert.match(summary.headline, /details captured for follow-up/);
    assert.equal(buildDemoAnalytics(session).contactCaptured, true);
  });

  test('a correction mid-call is reflected in the final record', async () => {
    const sessions = new SessionStore();
    const orch = new Orchestrator({ sessions, claude: null, log: silent });

    await orch.handleCallerUtterance('CA_fix', 'Water is pouring out from under my sink.');
    await orch.handleCallerUtterance('CA_fix', 'My number is 904-555-1234.');
    await orch.handleCallerUtterance('CA_fix', 'Actually use my other number, 904-555-5678.');

    assert.equal(sessions.get('CA_fix')!.contact.phone, '+19045555678');
  });

  test('what was captured is put in front of the model so it never re-asks', async () => {
    const { createRecordingClaudeClient } = await import('../src/claude/client.ts');
    const sessions = new SessionStore();
    const claude = createRecordingClaudeClient('Got it.');
    const orch = new Orchestrator({ sessions, claude, log: silent });

    await orch.handleCallerUtterance('CA_brief', 'My roof started leaking after the storm.');
    await orch.handleCallerUtterance('CA_brief', 'You can reach me at 904-555-0142.');

    const system = claude.lastSystem();
    assert.match(system, /Contact details on file:/);
    assert.match(system, /phone/);
    assert.match(system, /Never ask again/i);
  });
});
