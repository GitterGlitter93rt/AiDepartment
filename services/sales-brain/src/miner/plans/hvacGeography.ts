/**
 * Where to look for HVAC companies, and in what order.
 *
 * The V2 estate was built by ad-hoc runs against a handful of Florida cities, which is
 * why it holds 137 HVAC companies and no saved markets at all. A serious inventory needs
 * a plan rather than a habit, and the plan has to be written down so that the next
 * person can see what was covered and what was not.
 *
 * Two things shape it. HVAC demand follows cooling degree days and housing stock, so the
 * hot-and-growing South is where a contractor is most likely to be worth calling. And a
 * metro is not a city: the principal city is where the national chains rank, and the
 * independent operators -- who are the actual prospects -- sit in the suburbs and the
 * adjacent service towns. A search of "Tampa" does not find the company in Brandon.
 *
 * Ordered by expected yield so that an interrupted run has still done the valuable part.
 * Florida and Texas are deepest by instruction and because they are the two largest
 * always-on cooling markets in the country.
 */

export interface MarketTarget {
  city: string;
  state: string;
  /** Principal city of a metro, or one of the suburbs and service towns around it. */
  tier: 'PRINCIPAL' | 'SUBURB';
  metro: string;
}

function metro(name: string, state: string, principal: string,
               suburbs: readonly string[]): MarketTarget[] {
  return [
    { city: principal, state, tier: 'PRINCIPAL', metro: name },
    ...suburbs.map((city) => ({ city, state, tier: 'SUBURB' as const, metro: name })),
  ];
}

/** Florida — deepest coverage, and where the existing estate already sits. */
const FLORIDA: MarketTarget[] = [
  ...metro('Tampa Bay', 'FL', 'Tampa',
    ['St. Petersburg', 'Clearwater', 'Brandon', 'Riverview', 'Wesley Chapel', 'Lutz',
     'Plant City', 'Largo', 'Palm Harbor', 'Land O Lakes', 'Valrico', 'Seffner']),
  ...metro('Orlando', 'FL', 'Orlando',
    ['Winter Park', 'Kissimmee', 'Altamonte Springs', 'Apopka', 'Oviedo', 'Sanford',
     'Clermont', 'Winter Garden', 'Ocoee', 'Lake Mary', 'Longwood', 'St. Cloud']),
  ...metro('Miami–Fort Lauderdale', 'FL', 'Miami',
    ['Fort Lauderdale', 'Hialeah', 'Pembroke Pines', 'Hollywood', 'Miramar', 'Coral Springs',
     'Pompano Beach', 'Davie', 'Plantation', 'Sunrise', 'Homestead', 'Kendall']),
  ...metro('Jacksonville', 'FL', 'Jacksonville',
    ['Orange Park', 'St. Augustine', 'Fleming Island', 'Ponte Vedra Beach', 'Middleburg',
     'Jacksonville Beach', 'Green Cove Springs']),
  ...metro('Southwest Florida', 'FL', 'Fort Myers',
    ['Cape Coral', 'Naples', 'Bonita Springs', 'Estero', 'Port Charlotte', 'Punta Gorda']),
  ...metro('Sarasota', 'FL', 'Sarasota', ['Bradenton', 'Venice', 'North Port', 'Palmetto']),
  ...metro('Palm Beach', 'FL', 'West Palm Beach',
    ['Boca Raton', 'Delray Beach', 'Boynton Beach', 'Jupiter', 'Wellington', 'Palm Beach Gardens']),
  ...metro('Space Coast', 'FL', 'Melbourne', ['Palm Bay', 'Titusville', 'Rockledge', 'Cocoa']),
  ...metro('Ocala–Gainesville', 'FL', 'Ocala', ['Gainesville', 'The Villages', 'Leesburg']),
  ...metro('Panhandle', 'FL', 'Pensacola',
    ['Tallahassee', 'Panama City', 'Destin', 'Fort Walton Beach', 'Navarre']),
  ...metro('Port St. Lucie', 'FL', 'Port St. Lucie', ['Stuart', 'Vero Beach', 'Fort Pierce']),
  ...metro('Lakeland', 'FL', 'Lakeland', ['Winter Haven', 'Haines City', 'Bartow']),
];

/** Texas — the other always-on cooling market, and the largest by population. */
const TEXAS: MarketTarget[] = [
  ...metro('Dallas–Fort Worth', 'TX', 'Dallas',
    ['Fort Worth', 'Arlington', 'Plano', 'Irving', 'Garland', 'Frisco', 'McKinney',
     'Denton', 'Mesquite', 'Carrollton', 'Richardson', 'Lewisville', 'Allen', 'Grapevine',
     'Mansfield', 'Rockwall', 'Waxahachie', 'Burleson']),
  ...metro('Houston', 'TX', 'Houston',
    ['Katy', 'Sugar Land', 'Pearland', 'The Woodlands', 'Spring', 'Cypress', 'Humble',
     'Pasadena', 'League City', 'Conroe', 'Missouri City', 'Friendswood', 'Baytown',
     'Richmond', 'Tomball']),
  ...metro('San Antonio', 'TX', 'San Antonio',
    ['New Braunfels', 'Schertz', 'Boerne', 'Converse', 'Helotes', 'Seguin', 'Cibolo']),
  ...metro('Austin', 'TX', 'Austin',
    ['Round Rock', 'Cedar Park', 'Georgetown', 'Pflugerville', 'Leander', 'Kyle',
     'San Marcos', 'Buda', 'Hutto']),
  ...metro('El Paso', 'TX', 'El Paso', ['Socorro', 'Horizon City']),
  ...metro('Rio Grande Valley', 'TX', 'McAllen', ['Brownsville', 'Harlingen', 'Edinburg', 'Mission']),
  ...metro('Corpus Christi', 'TX', 'Corpus Christi', ['Portland', 'Kingsville']),
  ...metro('Waco–Killeen', 'TX', 'Waco', ['Killeen', 'Temple', 'Belton']),
  ...metro('Lubbock–Amarillo', 'TX', 'Lubbock', ['Amarillo', 'Midland', 'Odessa', 'Abilene']),
  ...metro('Tyler–Longview', 'TX', 'Tyler', ['Longview', 'Texarkana']),
];

const GEORGIA: MarketTarget[] = [
  ...metro('Atlanta', 'GA', 'Atlanta',
    ['Marietta', 'Alpharetta', 'Roswell', 'Sandy Springs', 'Lawrenceville', 'Duluth',
     'Kennesaw', 'Woodstock', 'Douglasville', 'McDonough', 'Peachtree City', 'Cumming',
     'Gainesville', 'Newnan', 'Conyers']),
  ...metro('Savannah', 'GA', 'Savannah', ['Pooler', 'Richmond Hill', 'Hinesville']),
  ...metro('Augusta', 'GA', 'Augusta', ['Evans', 'Martinez']),
  ...metro('Columbus–Macon', 'GA', 'Columbus', ['Macon', 'Warner Robins', 'Albany']),
];

const NORTH_CAROLINA: MarketTarget[] = [
  ...metro('Charlotte', 'NC', 'Charlotte',
    ['Concord', 'Gastonia', 'Huntersville', 'Matthews', 'Mooresville', 'Monroe',
     'Indian Trail', 'Kannapolis', 'Cornelius']),
  ...metro('Raleigh–Durham', 'NC', 'Raleigh',
    ['Durham', 'Cary', 'Chapel Hill', 'Apex', 'Wake Forest', 'Garner', 'Holly Springs',
     'Fuquay-Varina', 'Clayton']),
  ...metro('Greensboro–Winston-Salem', 'NC', 'Greensboro',
    ['Winston-Salem', 'High Point', 'Burlington', 'Kernersville']),
  ...metro('Coastal NC', 'NC', 'Wilmington', ['Jacksonville', 'Leland', 'Greenville']),
  ...metro('Asheville', 'NC', 'Asheville', ['Hendersonville', 'Arden']),
];

const SOUTH_CAROLINA: MarketTarget[] = [
  ...metro('Charleston', 'SC', 'Charleston',
    ['North Charleston', 'Mount Pleasant', 'Summerville', 'Goose Creek']),
  ...metro('Greenville', 'SC', 'Greenville', ['Spartanburg', 'Anderson', 'Simpsonville', 'Greer']),
  ...metro('Columbia', 'SC', 'Columbia', ['Lexington', 'Irmo', 'West Columbia']),
  ...metro('Myrtle Beach', 'SC', 'Myrtle Beach', ['Conway', 'Murrells Inlet']),
];

const TENNESSEE: MarketTarget[] = [
  ...metro('Nashville', 'TN', 'Nashville',
    ['Murfreesboro', 'Franklin', 'Hendersonville', 'Smyrna', 'Mount Juliet', 'Brentwood',
     'Clarksville', 'Gallatin', 'Lebanon']),
  ...metro('Memphis', 'TN', 'Memphis', ['Bartlett', 'Collierville', 'Germantown', 'Southaven']),
  ...metro('Knoxville', 'TN', 'Knoxville', ['Maryville', 'Farragut', 'Sevierville']),
  ...metro('Chattanooga', 'TN', 'Chattanooga', ['Cleveland', 'East Ridge']),
];

const ARIZONA: MarketTarget[] = [
  ...metro('Phoenix', 'AZ', 'Phoenix',
    ['Mesa', 'Chandler', 'Scottsdale', 'Glendale', 'Gilbert', 'Tempe', 'Peoria',
     'Surprise', 'Goodyear', 'Buckeye', 'Avondale', 'Queen Creek', 'Maricopa']),
  ...metro('Tucson', 'AZ', 'Tucson', ['Oro Valley', 'Marana', 'Sahuarita', 'Vail']),
  ...metro('Northern AZ', 'AZ', 'Prescott', ['Flagstaff', 'Prescott Valley', 'Lake Havasu City']),
  ...metro('Yuma', 'AZ', 'Yuma', []),
];

const NEVADA: MarketTarget[] = [
  ...metro('Las Vegas', 'NV', 'Las Vegas', ['Henderson', 'North Las Vegas', 'Summerlin', 'Pahrump']),
  ...metro('Reno', 'NV', 'Reno', ['Sparks', 'Carson City', 'Fernley']),
];

const COLORADO: MarketTarget[] = [
  ...metro('Denver', 'CO', 'Denver',
    ['Aurora', 'Lakewood', 'Arvada', 'Westminster', 'Thornton', 'Centennial',
     'Highlands Ranch', 'Littleton', 'Parker', 'Castle Rock', 'Broomfield']),
  ...metro('Colorado Springs', 'CO', 'Colorado Springs', ['Pueblo', 'Monument', 'Fountain']),
  ...metro('Northern CO', 'CO', 'Fort Collins', ['Greeley', 'Loveland', 'Longmont', 'Boulder']),
  ...metro('Western CO', 'CO', 'Grand Junction', ['Montrose']),
];

const UTAH: MarketTarget[] = [
  ...metro('Salt Lake City', 'UT', 'Salt Lake City',
    ['West Valley City', 'Provo', 'Orem', 'Sandy', 'Ogden', 'Lehi', 'Draper',
     'South Jordan', 'Layton', 'Bountiful', 'American Fork']),
  ...metro('Southern UT', 'UT', 'St. George', ['Cedar City', 'Hurricane']),
];

const CALIFORNIA: MarketTarget[] = [
  ...metro('Inland Empire', 'CA', 'Riverside',
    ['San Bernardino', 'Ontario', 'Corona', 'Temecula', 'Murrieta', 'Fontana',
     'Rancho Cucamonga', 'Moreno Valley', 'Hemet', 'Redlands']),
  ...metro('Sacramento', 'CA', 'Sacramento',
    ['Roseville', 'Elk Grove', 'Folsom', 'Rocklin', 'Citrus Heights', 'Davis']),
  ...metro('Central Valley', 'CA', 'Fresno',
    ['Bakersfield', 'Stockton', 'Modesto', 'Visalia', 'Clovis', 'Merced', 'Turlock']),
  ...metro('Coachella Valley', 'CA', 'Palm Springs', ['Palm Desert', 'Indio', 'La Quinta']),
  ...metro('Los Angeles', 'CA', 'Los Angeles',
    ['Long Beach', 'Santa Clarita', 'Pasadena', 'Torrance', 'Pomona', 'Lancaster',
     'Palmdale', 'Whittier', 'Burbank']),
  ...metro('Orange County', 'CA', 'Anaheim',
    ['Santa Ana', 'Irvine', 'Huntington Beach', 'Garden Grove', 'Orange', 'Fullerton']),
  ...metro('San Diego', 'CA', 'San Diego',
    ['Chula Vista', 'Escondido', 'Oceanside', 'El Cajon', 'Vista', 'Carlsbad']),
];

/**
 * The plan, in the order it should be worked.
 *
 * Principal cities of the deepest states first, then their suburbs, then the rest. An
 * interrupted run has covered the highest-yield ground; a completed one has covered the
 * independents in the suburbs, who are the prospects worth having.
 */
export const HVAC_MARKET_PLAN: readonly MarketTarget[] = [
  ...FLORIDA, ...TEXAS, ...ARIZONA, ...GEORGIA, ...NORTH_CAROLINA, ...TENNESSEE,
  ...SOUTH_CAROLINA, ...NEVADA, ...CALIFORNIA, ...COLORADO, ...UTAH,
];

export function planByState(): Map<string, MarketTarget[]> {
  const byState = new Map<string, MarketTarget[]>();
  for (const target of HVAC_MARKET_PLAN) {
    const bucket = byState.get(target.state) ?? [];
    bucket.push(target);
    byState.set(target.state, bucket);
  }
  return byState;
}

/**
 * Principal cities first across all states, then suburbs.
 *
 * A principal city answers "is this state worth working" for the price of one search;
 * suburbs are where the volume is. Working every principal first means the marginal
 * yield question can be asked about a state before its forty suburbs are bought.
 */
export function planInWorkingOrder(): MarketTarget[] {
  return [
    ...HVAC_MARKET_PLAN.filter((t) => t.tier === 'PRINCIPAL'),
    ...HVAC_MARKET_PLAN.filter((t) => t.tier === 'SUBURB'),
  ];
}
