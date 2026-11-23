type TimelineValue =
  | { readonly unit: 'time'; readonly extent: 'point'; readonly at: string }
  | { readonly unit: 'time'; readonly extent: 'span'; readonly start: string; readonly end?: string }
  | { readonly unit: 'day'; readonly extent: 'point'; readonly at: string }
  | { readonly unit: 'day'; readonly extent: 'span'; readonly start: string; readonly end?: string };

/** A date is YYYY-MM-DD. A date_time is an ISO 8601 UTC instant with milliseconds. */
export type FieldValue =
  | { readonly type: 'text' | 'url' | 'date' | 'date_time' | 'entry_ref'; readonly value: string }
  | { readonly type: 'file'; readonly value: string }
  | { readonly type: 'timeline'; readonly value: TimelineValue }
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'enum'; readonly value: { readonly variant_id: string; readonly field_values: FieldValues } }
  | { readonly type: 'object'; readonly value: { readonly field_values: FieldValues } }
  | { readonly type: 'array'; readonly value: readonly FieldValue[] }
  | { readonly type: 'set'; readonly value: readonly FieldValue[] };

export type FieldValues = Readonly<Record<string, FieldValue>>;

type ComputedError = {
  readonly phase: 'compile' | 'evaluate';
  readonly code: string;
  readonly message: string;
  /** Half-open UTF-16 offsets in the expression, or null when the position is unknown. */
  readonly range: { readonly start: number; readonly end: number } | null;
};

/** Entry timestamps are ISO 8601 UTC strings with milliseconds. */
export interface Entry {
  readonly id: string;
  readonly title: string;
  /** Markdown, or the empty string. */
  readonly body: string;
  /** All tags the entry carries, including derived tags. */
  readonly tag_ids: readonly string[];
  readonly attached_tag_ids?: readonly string[];
  readonly title_derived_by?: string | null;
  /** The tag supplying each derived field. */
  readonly derived_fields?: Readonly<Record<string, string>>;
  readonly field_values: FieldValues;
  readonly computed_errors?: Readonly<Record<string, ComputedError>>;
  readonly file_ids: readonly string[];
  readonly created_by: string;
  readonly updated_by: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
  /** An opaque identifier for this entry state. Compare it only for equality. */
  readonly revision: string;
}

export type CompareOperator = 'eq' | 'not_eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'overlaps';

export type FilterNode =
  | { readonly kind: 'and' | 'or'; readonly conditions: readonly FilterNode[] }
  | { readonly kind: 'not'; readonly condition: FilterNode }
  | { readonly kind: 'has_tag'; readonly tag_id: string }
  | { readonly kind: 'field'; readonly field_id: string; readonly operator: CompareOperator; readonly value: FieldValue }
  | { readonly kind: 'is_null' | 'is_not_null'; readonly field_id: string }
  | { readonly kind: 'items'; readonly field_id?: string; readonly quantifier: 'all' | 'any' | 'exactly_one'; readonly condition: FilterNode }
  | { readonly kind: 'item'; readonly operator: CompareOperator; readonly value: FieldValue }
  | { readonly kind: 'title'; readonly operator: CompareOperator; readonly value: string };

export type SortKey = 'created_at' | 'updated_at' | 'title' | { readonly field_id: string };
export type SortOrder = 'asc' | 'desc';

export interface EntrySort {
  readonly by: SortKey;
  readonly order: SortOrder;
}

export interface SearchEntries {
  readonly filter?: FilterNode;
  readonly sort?: EntrySort;
  readonly include_deleted?: boolean;
  readonly limit?: number;
  /** Use the previous page's next_cursor to continue. */
  readonly cursor?: string;
  readonly count?: boolean;
}

export interface EntryPage {
  readonly entries: readonly Entry[];
  /** Null at the end of the search. Empty pages can still have a cursor. */
  readonly next_cursor: string | null;
  /** Present when requested. Null when the search is too costly to count. */
  readonly count?: { readonly total: number } | null;
}

export interface CountEntries {
  readonly filter?: FilterNode;
}

export interface EntryCounts {
  readonly total: number;
  readonly tags: readonly { readonly tag_id: string; readonly count: number }[];
}

export interface CreateEntry {
  readonly title?: string;
  readonly body?: string;
  readonly tag_ids?: readonly string[];
  readonly field_values?: FieldValues;
  /** IANA time zone used for calendar-day defaults. */
  readonly time_zone?: string;
}

/** Changes the supplied title, attached tags and fields. Omitted keys keep their values. */
export interface UpdateEntry {
  readonly title?: string;
  readonly add_tag_ids?: readonly string[];
  readonly remove_tag_ids?: readonly string[];
  /** A null value clears the field. */
  readonly field_values?: Readonly<Record<string, FieldValue | null>>;
  readonly time_zone?: string;
}

export interface EntryUpdate {
  /** The stored update's revision. The returned entry can already reflect a later edit. */
  readonly revision: string;
  readonly entry: Entry;
}

export interface BodyEdit {
  readonly old: string;
  readonly new: string;
}

export interface ReplaceEntryBody {
  readonly body: string;
  readonly expected_revision: string;
}

export interface EditEntryBody {
  readonly edits: readonly BodyEdit[];
}

export interface EntryBodyUpdate {
  /** The stored body's revision. The returned entry can already reflect a later edit. */
  readonly revision: string;
  readonly entry: Entry;
}

type FieldDefaultValues = Readonly<Record<string, FieldDefaultValue>>;

/** For date or date_time, 'now' uses the save date or instant. */
export type FieldDefaultValue =
  | { readonly type: 'text' | 'url' | 'date' | 'date_time' | 'entry_ref'; readonly value: string }
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'timeline'; readonly value: { readonly unit: 'time' | 'day'; readonly extent: 'point'; readonly at: 'now' } }
  | { readonly type: 'enum'; readonly value: { readonly variant_id: string; readonly field_values: FieldDefaultValues } }
  | { readonly type: 'object'; readonly value: { readonly field_values: FieldDefaultValues } }
  | { readonly type: 'array'; readonly value: readonly FieldDefaultValue[] };

export interface FieldDefinition {
  readonly field_id: string;
  readonly name: string;
  readonly description?: string;
  readonly is_required: boolean;
  readonly order: number;
  readonly configuration: FieldConfiguration;
  readonly default_value?: FieldDefaultValue;
}

export interface EnumVariant {
  readonly variant_id: string;
  readonly label: string;
  readonly description?: string;
  /** Fields available when this variant is selected. */
  readonly fields: readonly FieldDefinition[];
}

export type FieldConfiguration =
  | { readonly kind: 'text' | 'boolean' | 'date' | 'date_time' | 'url' }
  | { readonly kind: 'number'; readonly format?: string }
  | {
    readonly kind: 'timeline';
    readonly units: readonly ['time' | 'day', ...('time' | 'day')[]];
    readonly extents: readonly ['point' | 'open' | 'range', ...('point' | 'open' | 'range')[]];
  }
  | { readonly kind: 'enum'; readonly variants: readonly EnumVariant[] }
  | { readonly kind: 'entry_ref'; readonly tag_ids: readonly string[] }
  | { readonly kind: 'file'; readonly extensions: readonly string[] }
  | { readonly kind: 'array'; readonly element: FieldConfiguration }
  | { readonly kind: 'set'; readonly element: FieldConfiguration }
  | { readonly kind: 'object'; readonly fields: readonly FieldDefinition[] };

export type TitleToken =
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'field'; readonly path: readonly string[] };

export interface TagDerives {
  readonly title_derive?: readonly TitleToken[];
  readonly tag_derives?: readonly {
    readonly tag_id: string;
    readonly field_map: readonly { readonly target: string; readonly source: readonly string[] }[];
  }[];
}

export type TagKind = 'tag' | 'folder';

type TagColor = 'gray' | 'red' | 'rose' | 'pink' | 'orange' | 'amber' | 'green' | 'emerald' | 'teal' | 'cyan' | 'blue' | 'indigo' | 'violet';

export interface Tag {
  readonly id: string;
  readonly kind: TagKind;
  readonly color: TagColor;
  readonly name: string;
  readonly description: string | null;
  /** Null for a tag at the root. */
  readonly parent_id: string | null;
  readonly order: number;
  readonly fields: readonly FieldDefinition[];
  readonly derives: TagDerives;
  readonly computed?: Readonly<Record<string, { readonly source: string; readonly mel_version: number }>>;
  readonly created_by: string;
  readonly updated_by: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly revision: string;
}
