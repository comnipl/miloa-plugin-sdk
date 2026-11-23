import type { Entry, FieldValue } from '@comnipl/miloa-plugin-contract';

type ComputedError = NonNullable<Entry['computed_errors']>[string];

export type FieldResult =
  | { readonly kind: 'value'; readonly value: FieldValue }
  | { readonly kind: 'null' }
  | { readonly kind: 'error'; readonly error: ComputedError };

export const readFieldResult = (
  { field_values: fieldValues, computed_errors: computedErrors }: Pick<Entry, 'field_values' | 'computed_errors'>,
  fieldId: string,
): FieldResult => {
  const error = computedErrors?.[fieldId];
  if (error !== undefined) return { kind: 'error', error };
  const value = fieldValues[fieldId];
  return value === undefined ? { kind: 'null' } : { kind: 'value', value };
};
