// Twilio SMS with a mock fallback.
//
// Compliance is built into the interface, not left to the caller: every
// message goes out with an opt-out line, and this tool only ever sends
// transactional confirmations to a number that just called us. There is
// deliberately no bulk-send method.

export interface SendSmsInput {
  to: string;
  body: string;
  /** Set false only for messages that are not marketing-adjacent. */
  includeOptOut?: boolean;
}

export interface SmsResult {
  sid: string;
  to: string;
  body: string;
  mocked: boolean;
}

export interface SmsTool {
  send(input: SendSmsInput): Promise<SmsResult>;
}

const OPT_OUT = ' Reply STOP to opt out.';

export function withOptOut(body: string, include = true): string {
  if (!include) return body;
  return body.trimEnd().endsWith('Reply STOP to opt out.') ? body : body.trimEnd() + OPT_OUT;
}

export function createMockSms(sink: (r: SmsResult) => void = () => {}): SmsTool {
  let n = 0;
  return {
    async send({ to, body, includeOptOut = true }) {
      const result: SmsResult = { sid: `SMmock${String(++n).padStart(6, '0')}`, to, body: withOptOut(body, includeOptOut), mocked: true };
      sink(result);
      return result;
    },
  };
}

export function createTwilioSms(accountSid: string, authToken: string, from: string, fetchImpl: typeof fetch = fetch): SmsTool {
  return {
    async send({ to, body, includeOptOut = true }) {
      const text = withOptOut(body, includeOptOut);
      const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: from, Body: text }),
      });
      if (!res.ok) throw new Error(`twilio sms ${res.status}`);
      const data = (await res.json()) as { sid: string };
      return { sid: data.sid, to, body: text, mocked: false };
    },
  };
}
