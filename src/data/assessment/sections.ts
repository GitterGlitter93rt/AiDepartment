import type { SectionId } from './types';

export interface SectionMeta {
  id: SectionId;
  navLabel: string;
  navSubtitle: string;
  icon: string;
  /** True if this section only appears for some respondents. */
  conditional: boolean;
}

// Order controls both nav display order and default question flow order.
export const SECTIONS: SectionMeta[] = [
  { id: 'companyProfile', navLabel: 'Company Profile', navSubtitle: 'About your business', icon: 'building-2', conditional: false },
  { id: 'leadership', navLabel: 'Strategy', navSubtitle: 'AI strategy and leadership', icon: 'target', conditional: false },
  { id: 'marketing', navLabel: 'Marketing', navSubtitle: 'Lead generation and demand', icon: 'megaphone', conditional: false },
  { id: 'sales', navLabel: 'Sales', navSubtitle: 'Sales process and conversion', icon: 'handshake', conditional: false },
  { id: 'customerExperience', navLabel: 'Customer Service', navSubtitle: 'Response and experience', icon: 'headset', conditional: false },
  { id: 'operations', navLabel: 'Operations', navSubtitle: 'Processes and workflows', icon: 'settings-2', conditional: false },
  { id: 'employees', navLabel: 'Employees', navSubtitle: 'People and AI readiness', icon: 'users', conditional: false },
  { id: 'technology', navLabel: 'Technology', navSubtitle: 'Systems and data', icon: 'cpu', conditional: false },
  { id: 'growthIntent', navLabel: 'Growth Plans', navSubtitle: 'Timing and priorities', icon: 'trending-up', conditional: false },
  { id: 'salesDetail', navLabel: 'Sales Detail', navSubtitle: 'Deeper sales discovery', icon: 'list-checks', conditional: true },
  { id: 'finance', navLabel: 'Finance', navSubtitle: 'Accounting workflows', icon: 'receipt', conditional: true },
  { id: 'capacity', navLabel: 'Capacity', navSubtitle: 'Workload and hiring', icon: 'gauge', conditional: true },
  { id: 'aiAgents', navLabel: 'AI Agents', navSubtitle: 'Automation opportunities', icon: 'bot', conditional: true },
];

export function getSectionMeta(id: SectionId): SectionMeta {
  const meta = SECTIONS.find((s) => s.id === id);
  if (!meta) throw new Error(`Unknown section: ${id}`);
  return meta;
}
