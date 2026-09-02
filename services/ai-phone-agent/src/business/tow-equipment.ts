// Working out what kind of truck to send.
//
// A tow is not one thing. A car that rolls and steers can go on a
// wheel lift; one with a locked wheel, a broken suspension or all four
// wheels driven has to go on a flatbed or it gets damaged on the way
// in. Sending the wrong truck means a driver arrives, cannot load the
// vehicle, and everybody starts again — which is the caller's whole
// afternoon.
//
// The decision is made here, deterministically, from facts the agent
// collected. Nothing about it is left to the model: "what truck do I
// need for a 2019 BMW with a locked wheel" is not a question to answer
// by generation.

export type TowType =
  /** Vehicle carried entirely on the bed. Safest, and required when
   * the wheels cannot turn freely or all four are driven. */
  | 'flatbed'
  /** A tilting bed. Interchangeable with flatbed for our purposes. */
  | 'rollback'
  /** Lifts one axle, the other rolls. Only for a vehicle that rolls
   * and steers, and only when the driven wheels can be lifted. */
  | 'wheel_lift'
  | 'standard_wrecker'
  /** Winching out of a ditch, a median, or anywhere the truck cannot
   * simply drive up to it. */
  | 'recovery'
  /**
   * We do not know enough to be sure.
   *
   * Deliberately a real outcome and not a failure: a human dispatcher
   * deciding is correct, and far better than guessing at equipment and
   * being wrong on a live roadside.
   */
  | 'dispatcher_review';

export type Drivetrain = 'FWD' | 'RWD' | 'AWD' | '4WD';

export type AccessType =
  | 'road' | 'parking_garage' | 'ditch' | 'median' | 'tight_access' | 'other';

export interface TowFacts {
  rolls?: boolean;
  steers?: boolean;
  wheelLocked?: boolean;
  suspensionDamage?: boolean;
  drivetrain?: Drivetrain;
  accessType?: AccessType;
  recoveryRequired?: boolean;
}

export interface TowRecommendation {
  towType: TowType;
  /** Why, in words a dispatcher can read. Never spoken to the caller. */
  reason: string;
  /** Facts that would change the answer, if we had them. */
  missing: string[];
}

/**
 * Which truck, and why.
 *
 * Ordered by how badly getting it wrong hurts. Recovery first: a car
 * in a ditch needs a winch whatever else is true about it, and the
 * drivetrain question is irrelevant until it is back on the tarmac.
 */
export function recommendTowType(facts: TowFacts): TowRecommendation {
  const missing: string[] = [];

  // Somewhere a truck cannot simply drive up to.
  if (facts.recoveryRequired === true || facts.accessType === 'ditch' || facts.accessType === 'median') {
    return { towType: 'recovery', reason: 'the vehicle has to be winched out before it can be loaded', missing };
  }

  // Height and turning limits are a property of the building, not the
  // car, and no rule of thumb survives a real parking garage.
  if (facts.accessType === 'parking_garage' || facts.accessType === 'tight_access') {
    return {
      towType: 'dispatcher_review',
      reason: 'restricted access — a dispatcher confirms what will physically fit before a truck is sent',
      missing,
    };
  }

  // Anything that stops a wheel turning freely means it goes on a bed.
  if (facts.rolls === false || facts.wheelLocked === true || facts.suspensionDamage === true) {
    const why = facts.rolls === false ? 'the vehicle does not roll'
      : facts.wheelLocked === true ? 'a wheel is locked'
        : 'suspension damage';
    return { towType: 'flatbed', reason: `${why}, so it cannot be towed on its own wheels`, missing };
  }

  if (facts.rolls === undefined) missing.push('rolls');

  // A car that rolls but will not steer cannot be guided onto a bed
  // under its own geometry, but it can still be winched flat.
  if (facts.steers === false) {
    return { towType: 'flatbed', reason: 'the vehicle does not steer, so it is winched onto a bed', missing };
  }
  if (facts.steers === undefined) missing.push('steers');

  // All four wheels driven: towing with any pair on the road damages
  // the drivetrain. Flatbed is the only safe answer.
  if (facts.drivetrain === 'AWD' || facts.drivetrain === '4WD') {
    return { towType: 'flatbed', reason: `${facts.drivetrain} — all four wheels driven, so it must be carried`, missing };
  }

  if (facts.drivetrain === undefined) {
    missing.push('drivetrain');
    return {
      towType: 'dispatcher_review',
      reason: 'drivetrain unknown — an all-wheel-drive car towed on its wheels is a drivetrain rebuild',
      missing,
    };
  }

  if (missing.length > 0) {
    return { towType: 'dispatcher_review', reason: `not enough known yet: ${missing.join(', ')}`, missing };
  }

  // Rolls, steers, two driven wheels, ordinary access.
  return {
    towType: 'flatbed',
    reason: 'a collision vehicle goes on a bed by default, even when it could be lifted',
    missing,
  };
}

/**
 * Drivetrain from what the caller actually said.
 *
 * There is deliberately no year/make/model lookup here. This service
 * has no vehicle data source, and a table of "a 2019 BMW is probably
 * rear-wheel drive" written from memory is invented data that decides
 * what truck turns up. When the caller has not said, the honest
 * outcomes are to ask, or to let a dispatcher decide — both of which
 * recommendTowType already produces.
 */
export function drivetrainFromSpeech(said: string): Drivetrain | null {
  if (/\b(all[- ]?wheel[- ]?drive|\bawd\b)\b/i.test(said)) return 'AWD';
  if (/\b(four[- ]?wheel[- ]?drive|4[- ]?wheel[- ]?drive|\b4wd\b|\b4x4\b)\b/i.test(said)) return '4WD';
  if (/\bfront[- ]?wheel[- ]?drive\b|\bfwd\b/i.test(said)) return 'FWD';
  if (/\brear[- ]?wheel[- ]?drive\b|\brwd\b/i.test(said)) return 'RWD';
  return null;
}

/** Whether the drivetrain still has to be established for a safe tow. */
export function needsDrivetrain(facts: TowFacts): boolean {
  return recommendTowType(facts).missing.includes('drivetrain');
}
