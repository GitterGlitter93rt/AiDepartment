/**
 * Vocabularies for synthetic company, person and place names.
 *
 * Realistic in shape because search ranking, name normalisation and dedupe cannot be
 * exercised by `Company 00417`. Not realistic in identity: every generated domain is
 * under `.invalid`, which RFC 2606 reserves so it can never resolve, and every
 * generated phone uses the 555 exchange, which the NANP does not assign to
 * subscribers. Nothing in a generated dataset can be dialled, emailed or visited.
 */

export const SYNTHETIC_MARKER = 'SYNTHETIC_FIXTURE';

/** Directory-assistance line; excluded from the generated pool. */
export const RESERVED_LINE = 1212;

export interface VerticalShape {
  id: string;
  label: string;
  /** Words a company in this vertical uses. */
  nouns: readonly string[];
  services: readonly string[];
  /** Problem families that fit the vertical, for hypotheses. */
  hypotheses: readonly { category: string; text: string; question: string }[];
}

export const VERTICALS: readonly VerticalShape[] = [
  {
    id: 'hvac', label: 'HVAC',
    nouns: ['Air', 'Air & Heat', 'Heating & Cooling', 'Climate Control', 'Comfort Systems',
            'Air Conditioning', 'Mechanical', 'HVAC Services'],
    services: ['emergency ac repair', 'ac replacement', 'heat pump service', 'duct cleaning'],
    hypotheses: [
      { category: 'after_hours', text: 'They may be losing after-hours calls nobody hears.',
        question: 'Who picks up after five?' },
      { category: 'missed_call', text: 'Calls during a service window may go unanswered.',
        question: 'What happens when both techs are on a roof?' },
      { category: 'speed_to_lead', text: 'Web leads may sit until someone gets back to the office.',
        question: 'How fast does a form fill get a call back?' },
    ],
  },
  {
    id: 'roofing', label: 'Roofing',
    nouns: ['Roofing', 'Roofing & Exteriors', 'Roof Systems', 'Contracting', 'Exteriors'],
    services: ['roof replacement', 'storm damage repair', 'roof inspection'],
    hypotheses: [
      { category: 'follow_up', text: 'Estimates may go out and never get followed up.',
        question: 'What happens to an estimate nobody answers?' },
      { category: 'speed_to_lead', text: 'Storm-season leads may outrun the office.',
        question: 'After a storm, who calls the backlog?' },
    ],
  },
  {
    id: 'collision-repair', label: 'Collision repair',
    nouns: ['Collision', 'Collision Center', 'Auto Body', 'Body Works', 'Paint & Body'],
    services: ['collision repair', 'paintless dent repair', 'insurance estimate'],
    hypotheses: [
      { category: 'follow_up', text: 'Estimates may not be followed up before the customer books elsewhere.',
        question: 'How many estimates turn into repairs?' },
      { category: 'after_hours', text: 'After-hours tow calls may reach nobody.',
        question: 'Who answers when a car is on a truck at nine at night?' },
    ],
  },
  {
    id: 'law-firms', label: 'Law firm',
    nouns: ['Law', 'Law Group', 'Legal', 'Law Offices', '& Associates', 'Injury Law'],
    services: ['personal injury intake', 'consultation scheduling'],
    hypotheses: [
      { category: 'missed_call', text: 'Intake calls may go to voicemail during a hearing.',
        question: 'Who takes an intake call while you are in court?' },
      { category: 'speed_to_lead', text: 'A missed intake call is a case that goes elsewhere.',
        question: 'How long before a new caller hears back?' },
    ],
  },
  {
    id: 'real-estate-brokerages', label: 'Real estate',
    nouns: ['Realty', 'Real Estate Group', 'Properties', 'Realty Partners', 'Home Group'],
    services: ['listing appointment', 'buyer consultation'],
    hypotheses: [
      { category: 'speed_to_lead', text: 'Portal leads may not be answered inside five minutes.',
        question: 'What happens to a Zillow lead at eight at night?' },
    ],
  },
  {
    id: 'plumbing', label: 'Plumbing',
    nouns: ['Plumbing', 'Plumbing & Drain', 'Plumbing Services', 'Pipe Works'],
    services: ['emergency plumbing', 'water heater replacement', 'drain cleaning'],
    hypotheses: [
      { category: 'after_hours', text: 'Emergency calls at night may not be answered.',
        question: 'Who answers a burst pipe at midnight?' },
      { category: 'missed_call', text: 'Calls may be missed while crews are under a house.',
        question: 'How often does the phone ring with nobody to answer it?' },
    ],
  },
  {
    id: 'dental', label: 'Dental practice',
    nouns: ['Dental', 'Dentistry', 'Family Dental', 'Dental Care', 'Smile Studio'],
    services: ['new patient appointment', 'emergency visit'],
    hypotheses: [
      { category: 'appointment_no_show', text: 'Cancellations may leave chairs empty with no waitlist call.',
        question: 'When somebody cancels, who fills the slot?' },
    ],
  },
  {
    id: 'electrical', label: 'Electrical',
    nouns: ['Electric', 'Electrical', 'Electrical Services', 'Power Systems', 'Wiring'],
    services: ['panel upgrade', 'generator install', 'emergency electrical'],
    hypotheses: [
      { category: 'follow_up', text: 'Quotes may not be chased once the crew is busy.',
        question: 'Who follows up on a quote in July?' },
    ],
  },
];

/** First words: place names, family names, and descriptive words. */
export const NAME_PREFIXES: readonly string[] = [
  'Northgate', 'Coastal', 'Palmetto', 'Riverside', 'Southside', 'Beaches', 'Mandarin',
  'Baymeadows', 'Orange Park', 'Ponte Vedra', 'Atlantic', 'Gateway', 'Heritage', 'Anchor',
  'Trident', 'Blue Ridge', 'Ironwood', 'Sawgrass', 'Deerwood', 'Julington', 'Arlington',
  'Westside', 'Springfield', 'Avondale', 'Murray Hill', 'Fort Caroline', 'Kingsley',
  'Amelia', 'Nassau', 'Clay County', 'Duval', 'St. Johns', 'Bartram', 'Nocatee',
  'Intracoastal', 'Marsh Landing', 'Tidewater', 'Lighthouse', 'Cypress', 'Magnolia',
  'Live Oak', 'Pinehurst', 'Whitehouse', 'Normandy', 'Cedar Creek', 'Black Creek',
  'Ortega', 'San Marco', 'Riverplace', 'Southbank',
];

export const FAMILY_NAMES: readonly string[] = [
  'Alvarez', 'Whitfield', 'Okafor', 'Nguyen', 'Delgado', 'Brennan', 'Kowalski', 'Castillo',
  'Sharma', 'Petrov', 'MacLeod', 'Fitzgerald', 'Hollis', 'Bergstrom', 'Ferraro',
  'Ademola', 'Quintero', 'Vasquez', 'Lindqvist', 'Abernathy', 'Cho', 'Ramirez',
  'Sutherland', 'Weatherby', 'Novak', 'Baptiste', 'Chandler', 'Ellison', 'Trujillo',
  'Underwood', "O'Donnell", "D'Amico", "O'Brien", 'Ashworth', 'Beauchamp',
];

/** Names that exercise Unicode handling in normalisation and search. */
export const UNICODE_FAMILY_NAMES: readonly string[] = [
  'Muñoz', 'Björnsson', 'Şahin', 'Krüger', 'Ólafsdóttir', 'Nguyễn', 'Đặng', 'Székely',
  'Łukasiewicz', 'Færøy', 'Åkerlund', 'Ceauşescu', 'Zoë Hartmann',
];

export const FIRST_NAMES: readonly string[] = [
  'Ray', 'Dana', 'Marcus', 'Elena', 'Terrence', 'Priya', 'Colin', 'Rosa', 'Hank', 'Nadia',
  'Wes', 'Imani', 'Stefan', 'Yolanda', 'Duncan', 'Lucia', 'Omar', 'Brenda', 'Kip',
  'Sylvia', 'Jerome', 'Anita', 'Cal', 'Meredith', 'Rafael', 'Joanne', 'Trevor', 'Camille',
];

export const SUFFIXES: readonly string[] = ['LLC', 'Inc', 'Inc.', 'Corp', 'Co', 'Company', 'LLC.', ''];

export const TITLES: readonly { title: string; role: string; priority: number }[] = [
  { title: 'Owner', role: 'owner', priority: 1 },
  { title: 'Owner / President', role: 'owner', priority: 1 },
  { title: 'President', role: 'president', priority: 2 },
  { title: 'General Manager', role: 'general_manager', priority: 5 },
  { title: 'Operations Manager', role: 'operations', priority: 8 },
  { title: 'Service Manager', role: 'service_manager', priority: 12 },
  { title: 'Office Manager', role: 'office_manager', priority: 20 },
  { title: 'Intake Coordinator', role: 'intake', priority: 30 },
  { title: 'Marketing Director', role: 'marketing', priority: 40 },
];

export interface MarketShape {
  postalCode: string;
  city: string;
  state: string;
  timezone: string;
  areaCode: string;
}

/** Jacksonville-area ZIPs plus a few other Florida markets, and one other timezone. */
export const MARKETS: readonly MarketShape[] = [
  { postalCode: '32256', city: 'Jacksonville', state: 'FL', timezone: 'America/New_York', areaCode: '904' },
  { postalCode: '32224', city: 'Jacksonville', state: 'FL', timezone: 'America/New_York', areaCode: '904' },
  { postalCode: '32207', city: 'Jacksonville', state: 'FL', timezone: 'America/New_York', areaCode: '904' },
  { postalCode: '32218', city: 'Jacksonville', state: 'FL', timezone: 'America/New_York', areaCode: '904' },
  { postalCode: '32082', city: 'Ponte Vedra Beach', state: 'FL', timezone: 'America/New_York', areaCode: '904' },
  { postalCode: '32084', city: 'St. Augustine', state: 'FL', timezone: 'America/New_York', areaCode: '904' },
  { postalCode: '32073', city: 'Orange Park', state: 'FL', timezone: 'America/New_York', areaCode: '904' },
  { postalCode: '32034', city: 'Fernandina Beach', state: 'FL', timezone: 'America/New_York', areaCode: '904' },
  { postalCode: '32117', city: 'Daytona Beach', state: 'FL', timezone: 'America/New_York', areaCode: '386' },
  { postalCode: '32601', city: 'Gainesville', state: 'FL', timezone: 'America/New_York', areaCode: '352' },
  { postalCode: '32801', city: 'Orlando', state: 'FL', timezone: 'America/New_York', areaCode: '407' },
  { postalCode: '33602', city: 'Tampa', state: 'FL', timezone: 'America/New_York', areaCode: '813' },
  { postalCode: '32502', city: 'Pensacola', state: 'FL', timezone: 'America/Chicago', areaCode: '850' },
  { postalCode: '32401', city: 'Panama City', state: 'FL', timezone: 'America/Chicago', areaCode: '850' },
  { postalCode: '33101', city: 'Miami', state: 'FL', timezone: 'America/New_York', areaCode: '305' },
];

export const STREETS: readonly string[] = [
  'Beach Blvd', 'Baymeadows Rd', 'Southside Blvd', 'Philips Hwy', 'Blanding Blvd',
  'Atlantic Blvd', 'San Jose Blvd', 'Roosevelt Blvd', 'Normandy Blvd', 'Kernan Blvd',
  'A1A South', 'US-1 South', 'Gate Pkwy', 'Touchton Rd', 'Belfort Rd',
];
