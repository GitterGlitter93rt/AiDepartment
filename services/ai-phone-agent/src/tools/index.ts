// Tool controller — one place that decides mock vs live, so no other
// module ever has to reason about credentials.

import type { Config } from '../config.ts';
import type { Logger } from '../logger.ts';
import { createMockCalendar, createGoogleCalendar, type CalendarTool } from './calendar.ts';
import { createMockSms, createTwilioSms, type SmsTool } from './sms.ts';
import { createTransferTool, type TransferTool } from './transfer.ts';
import { createPlaceholderCrm, type CrmTool } from './crm.ts';
import {
  createMockTow, createMockEsign, createMockUploadLink, createMockReferral, createMockLocationLink,
  type TowTool, type EsignTool, type UploadLinkTool, type PartnerReferralTool, type LocationLinkTool,
} from './actions.ts';

export interface Toolbox {
  calendar: CalendarTool;
  sms: SmsTool;
  transfer: TransferTool;
  crm: CrmTool;
  /** Tow dispatch. Mock until a provider is connected. */
  tow: TowTool;
  /** Electronic signature packets. Mock until DocuSign is connected. */
  esign: EsignTool;
  /** Secure upload links. The backend builds the URL, always. */
  uploadLink: UploadLinkTool;
  /** Consent-gated partner referrals. */
  referral: PartnerReferralTool;
  /** Secure roadside location sharing. */
  locationLink: LocationLinkTool;
  /**
   * What is real and what is not, reported on /health.
   *
   * Present so a demo can be given honestly: the agent's speech is
   * driven by these, and a mocked action is never described as done.
   */
  modes: {
    calendar: 'mock' | 'google';
    sms: 'mock' | 'twilio';
    tow: 'mock' | 'live';
    esign: 'mock' | 'docusign';
    uploadLink: 'mock' | 'live';
    referral: 'mock' | 'live';
    locationLink: 'mock' | 'live';
  };
}

export function createToolbox(cfg: Config, log: Logger): Toolbox {
  const calendar = cfg.mockCalendarMode
    ? createMockCalendar()
    : createGoogleCalendar({
        calendarId: cfg.googleCalendarId,
        clientId: cfg.googleClientId,
        clientSecret: cfg.googleClientSecret,
        refreshToken: cfg.googleRefreshToken,
      });

  const sms = cfg.mockSmsMode
    ? createMockSms((r) => log.log('tool.completed', { tool: 'sms', mocked: true, to: r.to }))
    : createTwilioSms(cfg.twilioAccountSid, cfg.twilioAuthToken, cfg.twilioPhoneNumber);

  // All four action providers are mock for now. Each is a drop-in seam
  // — same interface, same validation, same result shape — so
  // connecting a real one changes no conversation code.
  const tow = createMockTow((r) => log.log('tool.completed', { tool: 'dispatch_tow', mode: 'mocked', destination: r.destinationId }));
  const esign = createMockEsign((r) => log.log('tool.completed', { tool: 'send_esign_packet', mode: 'mocked', packetId: r.packetId }));
  const uploadLink = createMockUploadLink(cfg.uploadLinkBaseUrl);
  const referral = createMockReferral((r) => log.log('tool.completed', { tool: 'create_partner_referral', mode: 'mocked', partnerId: r.partnerId }));
  const locationLink = createMockLocationLink(cfg.locationLinkBaseUrl);

  return {
    calendar,
    sms,
    transfer: createTransferTool(cfg.humanTransferNumber),
    crm: createPlaceholderCrm((lead) => log.log('tool.completed', { tool: 'crm', mocked: true, industry: lead.industry })),
    tow,
    esign,
    uploadLink,
    referral,
    locationLink,
    modes: {
      calendar: cfg.mockCalendarMode ? 'mock' : 'google',
      sms: cfg.mockSmsMode ? 'mock' : 'twilio',
      tow: tow.mode,
      esign: esign.mode,
      uploadLink: uploadLink.mode,
      referral: referral.mode,
      locationLink: locationLink.mode,
    },
  };
}

/**
 * A fully mocked toolbox.
 *
 * Used by tests, the scenario simulator and the live-eval harness so a
 * new tool does not have to be threaded through a dozen hand-built
 * object literals — adding one to Toolbox would otherwise break every
 * call site that constructs one inline.
 */
export function createMockToolbox(over: Partial<Toolbox> = {}): Toolbox {
  const tow = createMockTow();
  const esign = createMockEsign();
  const uploadLink = createMockUploadLink();
  const referral = createMockReferral();
  return {
    calendar: createMockCalendar(),
    sms: createMockSms(),
    transfer: createTransferTool('+19045550100'),
    crm: createPlaceholderCrm(),
    tow, esign, uploadLink, referral,
    locationLink: createMockLocationLink(),
    modes: { calendar: 'mock', sms: 'mock', tow: 'mock', esign: 'mock', uploadLink: 'mock', referral: 'mock', locationLink: 'mock' },
    ...over,
  };
}

export type { CalendarTool, SmsTool, TransferTool, CrmTool };
export type { TowTool, EsignTool, UploadLinkTool, PartnerReferralTool, LocationLinkTool };
