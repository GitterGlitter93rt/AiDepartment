import type { CallContext, Lead } from './types.js';

export interface CallContextStore {
  getLead(id: string): Promise<Lead | undefined>;
  putLead(lead: Lead): Promise<void>;
  getContext(id: string): Promise<CallContext | undefined>;
  putContext(context: CallContext): Promise<void>;
  suppress(phone: string, reason: string): Promise<void>;
  isSuppressed(phone: string): Promise<boolean>;
}

export class InMemoryCallContextStore implements CallContextStore {
  private leads = new Map<string, Lead>();
  private contexts = new Map<string, CallContext>();
  private suppressions = new Map<string, string>();

  async getLead(id: string): Promise<Lead | undefined> { return this.leads.get(id); }
  async putLead(lead: Lead): Promise<void> { this.leads.set(lead.id, lead); }
  async getContext(id: string): Promise<CallContext | undefined> { return this.contexts.get(id); }
  async putContext(context: CallContext): Promise<void> {
    this.contexts.set(context.lead.id, context);
    this.leads.set(context.lead.id, context.lead);
  }
  async suppress(phone: string, reason: string): Promise<void> { this.suppressions.set(normalize(phone), reason); }
  async isSuppressed(phone: string): Promise<boolean> { return this.suppressions.has(normalize(phone)); }
}

function normalize(phone: string): string { return phone.replace(/\D/g, ''); }
