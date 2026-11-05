import type { EmployeePhoto, FaceAdjust, FaceBox, Person, PosterSlot, PosterTemplate } from '../../lib/api';

export const NO_ADJUST: FaceAdjust = { dx: 0, dy: 0, zoom: 1, rotate: 0 };

/** One selected participant: a person, the photo used for them, and where they stand. */
export interface Participant {
  person: Person;
  photo: EmployeePhoto;
  slot: string;
  adjust: FaceAdjust;
  /** Manual face box for this poster when automatic detection failed or was wrong. */
  face?: FaceBox;
}

export type Step = 'template' | 'people' | 'positions' | 'result';

/** Slots in the order automatic arrangement fills them (cake cutters first). */
export const slotOrder = (t: PosterTemplate) => t.slots.map((s) => s.id);

/** Gives everyone a slot: first two cut the cake, the rest fill outwards. */
export function autoArrange(list: Participant[], t: PosterTemplate, variation = 0): Participant[] {
  const order = slotOrder(t);
  const people =
    variation % 2 === 1 && list.length > 3 ? [...list.slice(2), ...list.slice(0, 2)] : list;
  return people.map((p, i) => ({ ...p, slot: order[i] }));
}

/** The first free slot (cutters first). */
export function freeSlot(list: Participant[], t: PosterTemplate) {
  const used = new Set(list.map((p) => p.slot));
  return slotOrder(t).find((s) => !used.has(s)) ?? '';
}

export function slotOf(t: PosterTemplate | null, id: string): PosterSlot | undefined {
  return t?.slots.find((s) => s.id === id);
}

/** Problems that block generation, in plain words. */
export function validate(list: Participant[], t: PosterTemplate | null, target: number): string[] {
  const out: string[] = [];
  if (!t) return ['Choose a template first.'];
  if (list.length < t.minParticipants) out.push(`Select at least ${t.minParticipants} people for this template.`);
  if (list.length > t.maxParticipants)
    out.push(`Too many participants: "${t.name}" has room for ${t.maxParticipants} people.`);
  if (target !== list.length) out.push(`Group size is set to ${target}, but ${list.length} ${list.length === 1 ? 'person is' : 'people are'} selected.`);
  const slots = list.map((p) => p.slot);
  if (slots.some((s, i) => !s || slots.indexOf(s) !== i)) out.push('Every person needs their own position.');
  const cutters = t.slots.filter((s) => s.role === 'cutter').map((s) => s.id);
  if (cutters.some((c) => !slots.includes(c)))
    out.push(cutters.length === 2 ? 'Put two people in the cake-cutting positions.' : 'Fill every cake-cutting position.');
  for (const p of list) {
    if (!p.face && !p.photo.face) out.push(`No face was found in ${p.person.name}'s photo — set it in Edit positions → Adjust face.`);
  }
  return out;
}
