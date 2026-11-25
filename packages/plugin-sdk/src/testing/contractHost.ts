import {
  ENTRY_SEARCH_PAGE_SIZE,
  MAX_WATCHES_PER_FRAME,
  MAX_WATCH_TAG_IDS,
  METHOD_SCOPES,
  PLUGIN_API_SCOPES,
  PROTOCOL_VERSION,
  RPC_ERROR_CODES,
  type ArchivedEntries,
  type BodyEdit,
  type CountEntries,
  type CreateEntry,
  type EditEntryBodyParams,
  type Entry,
  type EntryBodyUpdate,
  type EntryCounts,
  type EntryIdParams,
  type EntryPage,
  type EntryUpdate,
  type EntryUpdateParams,
  type FieldValue,
  type InitPayload,
  type PluginHostEventName,
  type PluginHostEventPayloads,
  type PluginRpcMethod,
  type PluginRpcParams,
  type ReplaceEntryBodyParams,
  type SearchEntries,
  type Tag,
  type UpdateEntry,
} from '@comnipl/miloa-plugin-contract';
import { hostFeatureError, PluginRpcError, type PluginClient } from '../client';

export interface ContractHostData {
  readonly tags: readonly Tag[];
  readonly entries: readonly Entry[];
}

export interface ContractHostOptions {
  readonly data: ContractHostData;
  /** Defaults to view mode, light, all API scopes allowed, and no network. */
  readonly init?: Partial<InitPayload>;
  /** Maximum entries per page. Defaults to `ENTRY_SEARCH_PAGE_SIZE`. Make it small to test paging. */
  readonly pageSize?: number;
}

export interface RecordedCall {
  readonly method: PluginRpcMethod;
  readonly params: unknown;
}

export interface ContractHost {
  /** Pass to `<MiloaProvider client={...}>`. */
  readonly client: PluginClient;
  /** Every request that arrived, including rejected ones, in arrival order. */
  readonly calls: readonly RecordedCall[];
  emit<E extends PluginHostEventName>(name: E, payload: PluginHostEventPayloads[E]): void;
}

const HOST_USER = '01jb0000000000000000000000';
const ULID_PATTERN = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const ULID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

type WatchParams = PluginRpcParams<'events.watch'>;
type UnwatchParams = PluginRpcParams<'events.unwatch'>;

const watchKeys: ParamKeys<WatchParams> = { tag_ids: true };
const unwatchKeys: ParamKeys<UnwatchParams> = { watch_id: true };
const idKeys: ParamKeys<EntryIdParams> = { id: true };
const updateParamsKeys: ParamKeys<EntryUpdateParams> = { id: true, update: true };
const replaceBodyKeys: ParamKeys<ReplaceEntryBodyParams> = { id: true, body: true, expected_revision: true };
const editBodyKeys: ParamKeys<EditEntryBodyParams> = { id: true, edits: true };
const bodyEditKeys: ParamKeys<BodyEdit> = { old: true, new: true };
const searchKeys: ParamKeys<SearchEntries> = {
  filter: true, sort: true, include_deleted: true, archived: true, limit: true, cursor: true, count: true,
};
const countKeys: ParamKeys<CountEntries> = { filter: true, archived: true };
const createKeys: ParamKeys<CreateEntry> = {
  title: true, body: true, tag_ids: true, field_values: true, time_zone: true,
};
const updateKeys: ParamKeys<UpdateEntry> = {
  title: true, add_tag_ids: true, remove_tag_ids: true, field_values: true, time_zone: true, archived: true,
};

type ParamKeys<T> = Readonly<Record<keyof T, true>>;

const apiError = (message: string) => new PluginRpcError(RPC_ERROR_CODES.apiError, message);

function readParams<T>(keys: ParamKeys<T>, method: PluginRpcMethod, params: unknown): T {
  if (typeof params !== 'object' || params === null || Array.isArray(params)
    || Object.keys(params).some(key => !Object.prototype.hasOwnProperty.call(keys, key))) {
    throw apiError(`invalid params for ${method}`);
  }
  return params as T;
}

function newEntryId(timestamp: number): string {
  let value = BigInt(timestamp);
  for (const byte of crypto.getRandomValues(new Uint8Array(10))) {
    value = (value << 8n) | BigInt(byte);
  }
  let id = '';
  for (let i = 0; i < 26; i++) {
    id = ULID_ALPHABET.charAt(Number(value & 31n)) + id;
    value >>= 5n;
  }
  return id;
}

function editTags(tagIds: readonly string[], { add_tag_ids = [], remove_tag_ids = [] }: UpdateEntry): readonly string[] {
  const tags = new Set([...tagIds, ...add_tag_ids]);
  for (const id of remove_tag_ids) tags.delete(id);
  return [...tags];
}

function matchesArchive(entry: Entry, archived: ArchivedEntries = 'exclude'): boolean {
  const isArchived = entry.archived_at != null;
  return archived === 'include' || isArchived === (archived === 'only');
}

/** Answers RPCs with fixture data. Search and count apply `archived` and ignore filters and sort orders. */
export function createContractHost(options: ContractHostOptions): ContractHost {
  const { tags } = options.data;
  const entries = new Map<string, Entry>();
  for (const entry of options.data.entries) {
    if (entry.deleted_at === null) entries.set(entry.id, entry);
  }
  const pageSize = options.pageSize ?? ENTRY_SEARCH_PAGE_SIZE;
  let revisions = 0;
  const mintRevision = () => `contract-host-${String(++revisions)}`;

  const init: InitPayload = {
    protocol_version: PROTOCOL_VERSION,
    plugin_id: 'contract-host',
    view_id: null,
    mode: 'view',
    config: null,
    base_filter: null,
    base_sort: null,
    theme: 'light',
    granted_permissions: {
      api: [...PLUGIN_API_SCOPES],
    },
    ...options.init,
  };
  const calls: RecordedCall[] = [];
  const listeners = new Set<{ name: PluginHostEventName; handler: (payload: never) => void }>();

  const watches = new Map<string, ReadonlySet<string> | null>();
  let nextWatchId = 0;

  const emit: ContractHost['emit'] = (name, payload) => {
    for (const listener of [...listeners]) {
      if (listener.name === name) (listener.handler as (payload: unknown) => void)(payload);
    }
  };

  function entryChanged(id: string, ...tagIds: (readonly string[])[]): void {
    const changedTags = [...new Set(tagIds.flat())];
    setTimeout(() => {
      if (!init.granted_permissions.api.includes('entries:read')) return;
      for (const [watch_id, tags] of watches) {
        if (tags === null || changedTags.some(tag => tags.has(tag))) {
          emit('watch_changed', { watch_id, entry_ids: [id] });
        }
      }
    }, 0);
  }

  function existing(id: string): Entry {
    const entry = entries.get(id);
    if (entry === undefined) throw apiError('not found');
    return entry;
  }

  function search(params: unknown): EntryPage {
    const request = readParams<SearchEntries>(searchKeys, 'entries.search', params ?? {});
    const all = [...entries.values()].filter(entry => matchesArchive(entry, request.archived));
    const offset = request.cursor === undefined ? 0 : Number(request.cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) throw apiError('cursor_mismatch');
    const end = offset + Math.min(request.limit ?? pageSize, pageSize);
    return {
      entries: all.slice(offset, end),
      next_cursor: end < all.length ? String(end) : null,
      ...(request.count === true ? { count: { total: all.length } } : {}),
    };
  }

  function counts(params: unknown): EntryCounts {
    const request = readParams<CountEntries>(countKeys, 'entries.counts', params ?? {});
    const matches = [...entries.values()].filter(entry => matchesArchive(entry, request.archived));
    const perTag = new Map<string, number>();
    for (const { tag_ids: tagIds } of matches) {
      for (const tagId of tagIds) perTag.set(tagId, (perTag.get(tagId) ?? 0) + 1);
    }
    return {
      total: matches.length,
      tags: [...perTag].map(([tagId, count]) => ({ tag_id: tagId, count })),
    };
  }

  function create(params: unknown): Entry {
    const input = readParams<CreateEntry>(createKeys, 'entries.create', params ?? {});
    const now = Date.now();
    const at = new Date(now).toISOString();
    const entry: Entry = {
      id: newEntryId(now),
      title: input.title ?? '',
      body: input.body ?? '',
      tag_ids: input.tag_ids ?? [],
      attached_tag_ids: input.tag_ids ?? [],
      title_derived_by: null,
      derived_fields: {},
      computed_errors: {},
      field_values: input.field_values ?? {},
      file_ids: [],
      created_by: HOST_USER,
      updated_by: null,
      created_at: at,
      updated_at: at,
      deleted_at: null,
      archived_at: null,
      revision: mintRevision(),
    };
    entries.set(entry.id, entry);
    entryChanged(entry.id, entry.tag_ids);
    return entry;
  }

  function update(params: unknown): EntryUpdate {
    const { id, update } = readParams<EntryUpdateParams>(updateParamsKeys, 'entries.update', params);
    const change = readParams<UpdateEntry>(updateKeys, 'entries.update', update);
    const entry = existing(id);
    const fieldValues: Record<string, FieldValue> = { ...entry.field_values };
    for (const [fieldId, value] of Object.entries(change.field_values ?? {})) {
      if (value === null) delete fieldValues[fieldId];
      else fieldValues[fieldId] = value;
    }
    const revision = mintRevision();
    const now = Date.now();
    const next: Entry = {
      ...entry,
      title: change.title ?? entry.title,
      tag_ids: editTags(entry.tag_ids, change),
      attached_tag_ids: editTags(entry.attached_tag_ids ?? entry.tag_ids, change),
      field_values: fieldValues,
      ...(change.archived === undefined ? {} : { archived_at: change.archived ? entry.archived_at ?? new Date(now).toISOString() : null }),
      updated_by: HOST_USER,
      updated_at: new Date(Math.max(now, Date.parse(entry.updated_at) + 1)).toISOString(),
      revision,
    };
    entries.set(id, next);
    entryChanged(id, entry.tag_ids, next.tag_ids);
    return { revision, entry: next };
  }

  function saveBody(entry: Entry, body: string): EntryBodyUpdate {
    const revision = mintRevision();
    const next: Entry = {
      ...entry,
      body,
      updated_by: HOST_USER,
      updated_at: new Date(Math.max(Date.now(), Date.parse(entry.updated_at) + 1)).toISOString(),
      revision,
    };
    entries.set(entry.id, next);
    entryChanged(entry.id, entry.tag_ids);
    return { revision, entry: next };
  }

  function replaceBody(params: unknown): EntryBodyUpdate {
    const { id, body, expected_revision } = readParams<ReplaceEntryBodyParams>(replaceBodyKeys, 'entries.replace_body', params);
    const entry = existing(id);
    if (entry.revision !== expected_revision) throw apiError('the entry changed since it was read');
    return saveBody(entry, body);
  }

  function editBody(params: unknown): EntryBodyUpdate {
    const { id, edits } = readParams<EditEntryBodyParams>(editBodyKeys, 'entries.edit_body', params);
    const entry = existing(id);
    let body = entry.body;
    for (const edit of edits) {
      const { old, new: replacement } = readParams<BodyEdit>(bodyEditKeys, 'entries.edit_body', edit);
      const start = body.indexOf(old);
      if (old === '' || start === -1 || body.indexOf(old, start + 1) !== -1) {
        throw apiError('body edit must match exactly once');
      }
      body = body.slice(0, start) + replacement + body.slice(start + old.length);
    }
    return saveBody(entry, body);
  }

  const answers: Record<PluginRpcMethod, (params: unknown) => unknown> = {
    'entries.search': search,
    'entries.get': params => existing(readParams<EntryIdParams>(idKeys, 'entries.get', params).id),
    'entries.counts': counts,
    'entries.create': create,
    'entries.update': update,
    'entries.replace_body': replaceBody,
    'entries.edit_body': editBody,
    'entries.delete': params => {
      const { id } = readParams<EntryIdParams>(idKeys, 'entries.delete', params);
      const entry = existing(id);
      entries.delete(id);
      entryChanged(id, entry.tag_ids);
      return null;
    },
    'events.watch': params => {
      const method = 'events.watch';
      const { tag_ids: tagIds } = readParams<WatchParams>(watchKeys, method, params);
      if (tagIds !== null && (!Array.isArray(tagIds) || tagIds.length > MAX_WATCH_TAG_IDS
        || Array.from<unknown>(tagIds).some(tag => typeof tag !== 'string' || !ULID_PATTERN.test(tag)))) {
        throw new PluginRpcError(RPC_ERROR_CODES.internal, `${method}: invalid tag_ids`);
      }
      if (watches.size >= MAX_WATCHES_PER_FRAME) {
        throw new PluginRpcError(RPC_ERROR_CODES.internal, `${method}: at most ${MAX_WATCHES_PER_FRAME} watches per frame`);
      }
      const watch_id = String(++nextWatchId);
      watches.set(watch_id, tagIds === null ? null : new Set(tagIds));
      return { watch_id };
    },
    'events.unwatch': params => {
      const method = 'events.unwatch';
      const { watch_id } = readParams<UnwatchParams>(unwatchKeys, method, params);
      if (typeof watch_id !== 'string') {
        throw new PluginRpcError(RPC_ERROR_CODES.internal, `${method}: invalid watch_id`);
      }
      watches.delete(watch_id);
      return null;
    },
    'tags.list': () => tags,
    'ui.open_entry': () => null,
    'ui.print': () => null,
    'view.set_draft_config': () => null,
    'view.set_content_height': () => null,
  };

  function answer(method: PluginRpcMethod, params: unknown): unknown {
    const scope = METHOD_SCOPES[method];
    if (scope !== null && !init.granted_permissions.api.includes(scope)) {
      throw new PluginRpcError(
        RPC_ERROR_CODES.permissionDenied,
        `permission denied: ${method} requires scope ${scope}`,
      );
    }
    return answers[method](params);
  }

  const on: PluginClient['on'] = (name, handler) => {
    const error = hostFeatureError(init.protocol_version.minor, name);
    if (error !== null) throw error;
    const listener = { name, handler };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const client: PluginClient = {
    init,
    request: ((method: PluginRpcMethod, params: unknown = null) => {
      const error = hostFeatureError(init.protocol_version.minor, method, params);
      if (error !== null) return Promise.reject(error);
      calls.push({ method, params });
      return new Promise<unknown>((resolve) => {
        resolve(answer(method, params));
      });
    }) as PluginClient['request'],
    on,
    onThemeChange: (handler) => on('theme_changed', (payload) => handler(payload.theme)),
    close: () => {
      watches.clear();
      listeners.clear();
    },
  };

  return {
    client,
    calls,
    emit,
  };
}
