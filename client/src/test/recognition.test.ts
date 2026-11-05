import { describe, expect, it } from 'vitest';
import type { EmployeePhoto, Person, PosterTemplate } from '../lib/api';
import { autoArrange, freeSlot, validate, NO_ADJUST, type Participant } from '../pages/recognition/state';

const SLOT_IDS = ['cut-left', 'cut-right', 'front-left-1', 'front-right-1', 'back-center'];
const template = {
  key: 't',
  name: 'SageIT Office Celebration',
  minParticipants: 2,
  maxParticipants: 4,
  slots: SLOT_IDS.map((id) => ({ id, label: id, role: id.startsWith('cut') ? 'cutter' : 'stand' })),
} as unknown as PosterTemplate;

const person = (i: number, face = true): Participant => ({
  person: { id: `u${i}`, name: `Person ${i}` } as Person,
  photo: { id: `p${i}`, face: face ? { x: 0.3, y: 0.2, w: 0.3, h: 0.3 } : null } as EmployeePhoto,
  slot: '',
  adjust: NO_ADJUST,
});

describe('group arrangement', () => {
  it('puts the first two people in the cake-cutting positions', () => {
    const out = autoArrange([person(1), person(2), person(3)], template);
    expect(out.map((p) => p.slot)).toEqual(['cut-left', 'cut-right', 'front-left-1']);
  });

  it('gives a different pair the knife on an alternate variation', () => {
    const out = autoArrange([person(1), person(2), person(3), person(4)], template, 1);
    expect(out.find((p) => p.slot === 'cut-left')?.person.id).toBe('u3');
  });

  it('fills the next free slot', () => {
    expect(freeSlot(autoArrange([person(1)], template), template)).toBe('cut-right');
  });
});

describe('validation before Generate with Image', () => {
  it('passes a complete group', () => {
    const list = autoArrange([person(1), person(2), person(3)], template);
    expect(validate(list, template, 3)).toEqual([]);
  });

  it('reports too many participants, missing cutters, wrong group size and missing faces', () => {
    const five = autoArrange([1, 2, 3, 4, 5].map((i) => person(i)), template);
    expect(validate(five, template, 5).join(' ')).toMatch(/Too many participants/);

    const noCutters = autoArrange([person(1), person(2)], template).map((p, i) => ({ ...p, slot: SLOT_IDS[i + 2] }));
    expect(validate(noCutters, template, 2).join(' ')).toMatch(/cake-cutting/);

    const pair = autoArrange([person(1), person(2, false)], template);
    expect(validate(pair, template, 3).join(' ')).toMatch(/Group size is set to 3/);
    expect(validate(pair, template, 2).join(' ')).toMatch(/No face was found in Person 2/);
  });
});
