// Pins the jam:easy-schema configuration, because both halves of it are load-bearing and
// neither one fails loudly when it is wrong: a bad `Null` compiles to "accepts anything"
// and a missing `Number` remap makes the database refuse every integer. See the comments
// in both/easySchemaConfig.ts.
import { describe, expect, it } from 'vitest';
import { easySchemaConfig } from 'meteor/jam:easy-schema';
import { Null } from '../../both/easySchemaConfig.ts';

describe('easy-schema configuration', () => {
  it('relaxes only the database validator, to moderate', () => {
    expect(easySchemaConfig()?.validationLevel).toBe('moderate');
  });

  it('maps Number to the bson alias that also matches int', () => {
    expect(easySchemaConfig()?.additionalBsonTypes).toMatchObject({ Number: 'number' });
  });

  describe('the Null matcher', () => {
    it('is registered as a bson type', () => {
      expect(easySchemaConfig()?.additionalBsonTypes).toMatchObject({ Null: 'null' });
    });

    // The generator looks this name up in its type map. Without it the matcher compiles to
    // an empty `$jsonSchema` branch that accepts any value at all.
    it('carries the name the generator looks up', () => {
      expect(Null.name).toBe('Null');
    });

    it('matches null and nothing else', () => {
      expect(Null.condition(null)).toBe(true);
      expect(Null.condition(undefined)).toBe(false);
      expect(Null.condition(0)).toBe(false);
      expect(Null.condition('')).toBe(false);
    });
  });
});
