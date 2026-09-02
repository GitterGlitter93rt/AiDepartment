// Getting the keys to the tow driver when the caller cannot wait.
//
// People leave. They get a lift home, they go to hospital, they have
// to collect a child. The vehicle stays where it is and the driver
// still has to move it, so the keys have to be somewhere agreed —
// and "somewhere agreed" has to reach the driver as an instruction,
// not as a note in a transcript nobody reads.
//
// Deliberately NOT a second trip: no tow company is sent to a house to
// collect a key. The key is left at the vehicle, wherever the caller
// chooses, and that choice is theirs to make.

export type KeyHandoffMethod =
  /** The caller waits and hands them over. The simplest case. */
  | 'hand_to_driver'
  /** Left somewhere on the outside of the vehicle. */
  | 'hidden_at_vehicle'
  /** Left in the cabin, which means the vehicle stays unlocked. */
  | 'inside_vehicle'
  /** Someone else on scene will pass them on. */
  | 'third_party_handoff'
  | 'other';

export interface KeyHandoff {
  method: KeyHandoffMethod;
  /** Normalised for the dispatch record: 'driver_rear_tire'. */
  location?: string;
  /** Verbatim for the driver: "Key on top of driver's rear tire." */
  instructions: string;
  /** Whether the vehicle is being left unlocked. */
  unlocked?: boolean;
}

/** Recognisable places people actually leave a key. */
const PLACES: [RegExp, string, string][] = [
  [/\b(driver'?s?[- ]side )?rear (tyre|tire|wheel)\b/i, 'driver_rear_tire', "on top of the driver's rear tire"],
  [/\b(front )?(driver'?s?[- ]side )?(tyre|tire|wheel) ?well\b/i, 'driver_wheel_well', 'in the wheel well'],
  [/\bunder (the )?(driver'?s?|front) seat\b/i, 'under_driver_seat', 'under the driver’s seat'],
  [/\b(in|inside) the (glove ?(box|compartment))\b/i, 'glove_box', 'in the glove box'],
  [/\b(centre|center) console\b/i, 'center_console', 'in the center console'],
  [/\b(gas|fuel) (door|cap|flap)\b/i, 'fuel_door', 'behind the fuel door'],
  [/\bsun ?visor\b/i, 'sun_visor', 'above the sun visor'],
  [/\bon the (front )?(tyre|tire|wheel)\b/i, 'front_tire', 'on top of the front tire'],
  [/\bbumper\b/i, 'bumper', 'on the bumper'],
];

/**
 * What the caller said about the keys, as a dispatch instruction.
 *
 * Returns null when they have not actually said where — which is the
 * cue to ask, not to assume. Guessing a key location produces a driver
 * feeling around a stranger's wheel arch in the dark.
 */
export function parseKeyHandoff(said: string): KeyHandoff | null {
  const unlocked = /\b(leave|leaving) it unlocked\b|\bunlocked\b/i.test(said);

  const place = PLACES.find(([re]) => re.test(said));
  const inside = /\b(in|inside) the (car|vehicle|cabin)\b|\bunder (the )?(driver'?s?|front) seat\b|\bglove ?(box|compartment)\b|\b(centre|center) console\b/i.test(said);

  if (place) {
    const [, location, phrase] = place;
    const method: KeyHandoffMethod = inside ? 'inside_vehicle' : 'hidden_at_vehicle';
    return {
      method,
      location,
      instructions: `Key ${phrase}.${method === 'inside_vehicle' || unlocked ? ' Vehicle left unlocked.' : ''}`,
      unlocked: method === 'inside_vehicle' ? true : unlocked || undefined,
    };
  }

  if (/\b(wait|waiting|i'?ll be here|stay|staying) (here|with (the|my) (car|vehicle))?\b/i.test(said)
      && !/\b(have to|need to|got to|gotta) (go|leave)\b/i.test(said)) {
    return { method: 'hand_to_driver', instructions: 'Caller is waiting with the vehicle and will hand the keys over.' };
  }

  if (/\b(my |the )?(wife|husband|son|daughter|friend|brother|sister|partner|coworker|colleague)\b[^.]{0,40}\b(here|waiting|stay|meet)\b/i.test(said)) {
    return { method: 'third_party_handoff', instructions: 'Someone else on scene will hand the keys to the driver.' };
  }

  return null;
}

/** Whether the caller has said they are leaving the vehicle. */
export function saysLeaving(said: string): boolean {
  return /\b(have to|need to|got to|gotta|i'?m going to|i'?ll) (go|leave|head off|take off)\b/i.test(said)
    || /\bcan'?t (stay|wait)\b/i.test(said)
    || /\bgetting a (ride|lift)\b/i.test(said)
    || /\b(leaving|leave) (the|my) (car|vehicle|truck) (here|there)\b/i.test(said);
}

/**
 * How the vehicle is handed over at OUR end.
 *
 * A caller who has just left their car on a bridge wants to know it
 * will not sit on a truck overnight. Both outcomes are fine and the
 * honest one depends only on whether the shop is open when it lands.
 */
export type ShopKeyDeliveryMethod = 'staff_handoff' | 'secure_key_drop';

export function shopDeliveryReassurance(destinationName: string): string {
  return `Once they pick it up they'll bring the vehicle straight to ${destinationName}. `
    + `If we're closed when it arrives, the driver puts the key in our secure key drop, `
    + `so it's checked in first thing when we open.`;
}
