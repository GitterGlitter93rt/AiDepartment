// Tool controller — one place that decides mock vs live, so no other
// module ever has to reason about credentials.

import type { Config } from '../config.ts';
import type { Logger } from '../logger.ts';
import { createMockCalendar, createGoogleCalendar, type CalendarTool } from './calendar.ts';
import { createMockSms, createTwilioSms, type SmsTool } from './sms.ts';
import { createTransferTool, type TransferTool } from './transfer.ts';
import { createPlaceholderCrm, type CrmTool } from './crm.ts';

export interface Toolbox {
  calendar: CalendarTool;
  sms: SmsTool;
  transfer: TransferTool;
  crm: CrmTool;
  modes: { calendar: 'mock' | 'google'; sms: 'mock' | 'twilio' };
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

  return {
    calendar,
    sms,
    transfer: createTransferTool(cfg.humanTransferNumber),
    crm: createPlaceholderCrm((lead) => log.log('tool.completed', { tool: 'crm', mocked: true, industry: lead.industry })),
    modes: {
      calendar: cfg.mockCalendarMode ? 'mock' : 'google',
      sms: cfg.mockSmsMode ? 'mock' : 'twilio',
    },
  };
}

export type { CalendarTool, SmsTool, TransferTool, CrmTool };
