import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PluginClient } from './client';
import { useMiloaContext } from './provider';
import {
  ENTRY_SEARCH_PAGE_SIZE,
  type GrantedPermissions,
  type PluginFrameMode,
  type PluginTheme,
  type PluginRpcParams,
  type CountEntries,
  type CreateEntry,
  type EditEntryBody,
  type Entry,
  type EntryBodyUpdate,
  type EntryCounts,
  type EntryPage,
  type EntrySort,
  type EntryUpdate,
  type FilterNode,
  type ReplaceEntryBody,
  type SearchEntries,
  type Tag,
  type UpdateEntry,
} from '@comnipl/miloa-plugin-contract';

const LIVE_REFETCH_DELAY_MS = 300;
const EMPTY_LIST: readonly never[] = [];

export interface MiloaInfo {
  pluginId: string;
  viewId: string | null;
  mode: PluginFrameMode;
  /** Plugin settings saved on the view. Updated by the config_changed event. */
  config: unknown;
  baseFilter: FilterNode | null;
  baseSort: EntrySort | null;
  /** Current theme. Updated by the theme_changed event. */
  theme: PluginTheme;
  permissions: GrantedPermissions;
}

/** Returns the frame's init data and the current theme and settings. */
export function useMiloa(): MiloaInfo {
  const { client, theme, config } = useMiloaContext();
  const { plugin_id: pluginId, view_id: viewId, mode, base_filter: baseFilter, base_sort: baseSort, granted_permissions: grantedPermissions } = client.init;
  return useMemo(
    () => ({
      pluginId,
      viewId,
      mode,
      config,
      baseFilter,
      baseSort,
      theme,
      permissions: grantedPermissions,
    }),
    [pluginId, viewId, mode, config, baseFilter, baseSort, theme, grantedPermissions],
  );
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function useJsonKeyedParams<P>(params: P | null): P | null {
  const key = params === null ? null : JSON.stringify(params);
  return useMemo(() => (key === null ? null : (JSON.parse(key) as P)), [key]);
}

export type WatchSpec = PluginRpcParams<'events.watch'>;

export type UseWatchResult =
  | { status: 'inactive' | 'registering' | 'registered'; error: null }
  | { status: 'failed'; error: Error };

const INACTIVE_WATCH = { status: 'inactive', error: null } as const;
const REGISTERING_WATCH = { status: 'registering', error: null } as const;

/** Does not register while `spec` is null. When `spec.tag_ids` is null, watches all entries. */
export function useWatch(
  spec: WatchSpec | null,
  onChange: (entryIds: readonly string[] | null) => void,
): UseWatchResult {
  const { client } = useMiloaContext();
  const params = useJsonKeyedParams(spec);
  const registration = useMemo(() => params === null ? null : { client, params }, [client, params]);
  const [settled, setSettled] = useState<{ registration: typeof registration; result: UseWatchResult }>();
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (registration === null) return;
    const { client, params } = registration;
    let disposed = false;
    let watchId: string | undefined;
    let unsubscribe: (() => void) | undefined;
    const unwatch = (watch_id: string) => {
      void client.request('events.unwatch', { watch_id }).catch(() => {});
    };

    const register = async () => {
      try {
        unsubscribe = client.on('watch_changed', ({ watch_id, entry_ids }) => {
          if (watch_id === watchId) onChangeRef.current(entry_ids);
        });
        const { watch_id } = await client.request('events.watch', params);
        if (disposed) {
          unwatch(watch_id);
          return;
        }
        watchId = watch_id;
        setSettled({ registration, result: { status: 'registered', error: null } });
      } catch (error) {
        unsubscribe?.();
        if (!disposed) setSettled({ registration, result: { status: 'failed', error: toError(error) } });
      }
    };
    void register();

    return () => {
      disposed = true;
      unsubscribe?.();
      if (watchId !== undefined) unwatch(watchId);
    };
  }, [registration]);

  if (registration === null) return INACTIVE_WATCH;
  return settled?.registration === registration ? settled.result : REGISTERING_WATCH;
}

type ReadPhase = 'idle' | 'loading' | 'loading-and-dirty';
type LiveSubscription = { spec: WatchSpec; entryId?: string } | 'tags' | null;

function useLiveRequest<T>(
  load: ((signal: AbortSignal) => Promise<T>) | null,
  initialData: T,
  live: LiveSubscription,
) {
  const { client } = useMiloaContext();
  type Result = { load: NonNullable<typeof load>; data: T; error: Error | null };
  const [state, setState] = useState<{ result: Result | null; reading: boolean }>({
    result: null,
    reading: false,
  });
  const read = useRef<{
    notify: () => void;
    refetch: () => void;
  } | null>(null);
  const watch = useWatch(live === 'tags' ? null : live?.spec ?? null, entryIds => {
    const entryId = live === 'tags' ? undefined : live?.entryId;
    if (entryId === undefined || entryIds === null || entryIds.includes(entryId)) read.current?.notify();
  });

  const liveTags = live === 'tags';
  useEffect(() => {
    if (liveTags) return client.on('tags_changed', () => read.current?.notify());
  }, [client, liveTags]);

  const ready = watch.status === 'inactive' || watch.status === 'registered';
  useEffect(() => {
    if (!ready || load === null) return;
    const controller = new AbortController();
    let phase: ReadPhase = 'idle';
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fire = () => {
      timer = undefined;
      if (phase !== 'idle') {
        phase = 'loading-and-dirty';
        return;
      }
      phase = 'loading';
      setState(previous => ({ ...previous, reading: true }));
      load(controller.signal).then(
        data => settle(() => ({ load, data, error: null })),
        error => settle(previous => ({
          load,
          data: previous?.load === load ? previous.data : initialData,
          error: toError(error),
        })),
      );
    };
    const schedule = () => {
      timer ??= setTimeout(fire, LIVE_REFETCH_DELAY_MS);
    };
    const settle = (update: (previous: Result | null) => Result) => {
      if (controller.signal.aborted) return;
      const dirty = phase === 'loading-and-dirty';
      phase = 'idle';
      setState(previous => ({ result: update(previous.result), reading: false }));
      if (dirty) schedule();
    };

    read.current = {
      notify: schedule,
      refetch() {
        clearTimeout(timer);
        fire();
      },
    };
    fire();
    return () => {
      read.current = null;
      controller.abort();
      clearTimeout(timer);
    };
  }, [initialData, load, ready]);

  const refetch = useCallback(() => read.current?.refetch(), []);
  const result = state.result?.load === load ? state.result : null;
  return {
    data: result === null ? initialData : result.data,
    loading: load !== null && watch.status !== 'failed' && result === null,
    refreshing: result !== null && watch.status !== 'failed' && (state.reading || watch.status === 'registering'),
    error: watch.error ?? result?.error ?? null,
    refetch,
  };
}

function searchWatch(filter: FilterNode | undefined): LiveSubscription {
  const conditions = filter?.kind === 'and' ? filter.conditions : filter === undefined ? [] : [filter];
  const tagIds = conditions.flatMap(condition => condition.kind === 'has_tag' ? [condition.tag_id] : []);
  return { spec: { tag_ids: tagIds.length === 0 ? null : [...new Set(tagIds)] } };
}

export interface UseEntryCountsResult {
  /** Counts last read for the current arguments. null when not fetched yet. */
  counts: EntryCounts | null;
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Total entry count and per-tag counts (`entries.counts`).
 * Refetches when params change (compared as JSON) and when the watch notifies. `live: false` stops watching.
 * While `params` is null or `opts.enabled` is false, it does not fetch and resets `counts` to null. Requires scope: `entries:read`.
 */
export function useEntryCounts(
  params: CountEntries | null,
  opts: { enabled?: boolean; live?: boolean } = {},
): UseEntryCountsResult {
  const { client } = useMiloaContext();
  const stableParams = useJsonKeyedParams(params);
  const enabled = (opts.enabled ?? true) && stableParams !== null;

  const count = useMemo(
    () => enabled && stableParams !== null ? () => client.request('entries.counts', stableParams) : null,
    [client, enabled, stableParams],
  );
  const live = enabled && opts.live !== false ? searchWatch(stableParams?.filter) : null;
  const { data: counts, loading, refreshing, error, refetch } = useLiveRequest<EntryCounts | null>(count, null, live);

  return { counts, loading, refreshing, error, refetch };
}

export interface UseEntrySearchResult {
  /** Page last read for the current arguments. null when not fetched yet. The count (`count: true`) is in `page.count`. */
  page: EntryPage | null;
  entries: readonly Entry[];
  /** Pass to `params.cursor` to read the next page. null on the last page. */
  nextCursor: string | null;
  /** true while waiting for the first result or error for the current arguments. */
  loading: boolean;
  /** true while reading again after returning a result or error for the same arguments. Meanwhile it still returns the previous result and error. */
  refreshing: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * One page of entry search (`entries.search`). When `params.limit` is omitted, it fetches
 * up to `ENTRY_SEARCH_PAGE_SIZE` entries. A page can have few entries, or none, and still have a `nextCursor`,
 * so use only `nextCursor` to decide whether more pages follow. To get every match, use `useAllEntries`.
 * Refetches when params change (compared as JSON) and when the watch notifies. `live: false` stops watching.
 * While `params` is null or `opts.enabled` is false, it does not fetch and resets to an empty result. Requires scope: `entries:read`.
 */
export function useEntrySearch(
  params: SearchEntries | null,
  opts: { enabled?: boolean; live?: boolean } = {},
): UseEntrySearchResult {
  const { client } = useMiloaContext();
  const stableParams = useJsonKeyedParams(params);
  const enabled = (opts.enabled ?? true) && stableParams !== null;

  const search = useMemo(
    () =>
      enabled && stableParams !== null
        ? () =>
            client.request('entries.search', {
              ...stableParams,
              limit: stableParams.limit ?? ENTRY_SEARCH_PAGE_SIZE,
            })
        : null,
    [client, enabled, stableParams],
  );
  const live = enabled && opts.live !== false ? searchWatch(stableParams?.filter) : null;
  const { data: page, loading, refreshing, error, refetch } = useLiveRequest<EntryPage | null>(search, null, live);
  const entries = useMemo(() => (page?.entries ?? []), [page]);

  return {
    page,
    entries,
    nextCursor: page?.next_cursor ?? null,
    loading,
    refreshing,
    error,
    refetch,
  };
}

/**
 * Search criteria for `useAllEntries`. The hook uses `limit` / `cursor` for paging and does not accept `count`.
 */
export type AllEntriesParams = Omit<SearchEntries, 'limit' | 'cursor' | 'count'>;

export interface UseAllEntriesResult {
  entries: readonly Entry[];
  /** true while waiting for the first result or error for the current arguments. */
  loading: boolean;
  /** true while reading again after returning a result or error for the same arguments. Meanwhile it still returns the previous result and error. */
  refreshing: boolean;
  error: Error | null;
  refetch: () => void;
}

async function searchAllPages(
  client: PluginClient,
  params: AllEntriesParams,
  signal: AbortSignal,
): Promise<readonly Entry[]> {
  const uniqueById = new Map<string, Entry>();
  let cursor: string | null = null;
  do {
    const page: EntryPage = await client.request('entries.search', {
      ...params,
      limit: ENTRY_SEARCH_PAGE_SIZE,
      ...(cursor === null ? {} : { cursor }),
    });
    signal.throwIfAborted();
    for (const entry of page.entries) uniqueById.set(entry.id, entry);
    cursor = page.next_cursor;
  } while (cursor !== null);
  return [...uniqueById.values()];
}

/**
 * Returns every matching entry by reading pages in order until `nextCursor` is null.
 * Until all pages arrive, `entries` returns the full set last fetched for the current arguments, or is empty if none.
 * Refetch triggers and `enabled` work the same as in `useEntrySearch`. Requires scope: `entries:read`.
 */
export function useAllEntries(
  params: AllEntriesParams | null,
  opts: { enabled?: boolean; live?: boolean } = {},
): UseAllEntriesResult {
  const { client } = useMiloaContext();
  const stableParams = useJsonKeyedParams(params);
  const enabled = (opts.enabled ?? true) && stableParams !== null;

  const search = useMemo(
    () =>
      enabled && stableParams !== null
        ? (signal: AbortSignal) => searchAllPages(client, stableParams, signal)
        : null,
    [client, enabled, stableParams],
  );
  const live = enabled && opts.live !== false ? searchWatch(stableParams?.filter) : null;
  const { data: entries, loading, refreshing, error, refetch } = useLiveRequest<readonly Entry[]>(search, EMPTY_LIST, live);

  return { entries, loading, refreshing, error, refetch };
}

export interface UseEntryResult {
  entry: Entry | null;
  /** true while waiting for the first result or error for the current arguments. */
  loading: boolean;
  /** true while reading again after returning a result or error for the same arguments. Meanwhile it still returns the previous result and error. */
  refreshing: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetches one entry (`entries.get`). While `id` is null it does not fetch, and when `id` goes back
 * to null (for example, on deselect) it resets to `entry: null`. Watches for changes by default.
 * Requires scope: `entries:read`.
 */
export function useEntry(id: string | null, opts: { live?: boolean } = {}): UseEntryResult {
  const { client } = useMiloaContext();
  const get = useMemo(
    () => (id === null ? null : () => client.request('entries.get', { id })),
    [client, id],
  );
  const live = id !== null && opts.live !== false ? { spec: { tag_ids: null }, entryId: id } : null;
  const { data: entry, loading, refreshing, error, refetch } = useLiveRequest<Entry | null>(get, null, live);

  return { entry, loading, refreshing, error, refetch };
}

export interface UseTagsResult {
  tags: readonly Tag[];
  /** true while waiting for the first result or error. */
  loading: boolean;
  /** true while reading again after returning a result or error. Meanwhile it still returns the previous result and error. */
  refreshing: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Tag list (`tags.list`). Refetches automatically on `tags_changed`.
 * `live: false` stops the automatic refetch. Requires scope: `tags:read`.
 */
export function useTags(opts: { live?: boolean } = {}): UseTagsResult {
  const { client } = useMiloaContext();
  const list = useCallback(() => client.request('tags.list'), [client]);
  const { data: tags, loading, refreshing, error, refetch } = useLiveRequest<readonly Tag[]>(list, EMPTY_LIST, opts.live === false ? null : 'tags');
  return { tags, loading, refreshing, error, refetch };
}

export interface EntryMutations {
  /** Creates an entry. Resolves to the entry in the same shape that `entries.get` reads. Requires scope: `entries:write`. */
  create: (input: CreateEntry) => Promise<Entry>;
  /**
   * Updates the title, tags, and fields without a revision. `add_tag_ids` and `remove_tag_ids` add and remove tags,
   * and `null` in `field_values` clears the value. The resolved `revision` is the version this update wrote. Requires scope: `entries:write`.
   */
  update: (id: string, update: UpdateEntry) => Promise<EntryUpdate>;
  /** Replaces the body when the body revision matches. Requires scope: `entries:write`. */
  replaceBody: (id: string, input: ReplaceEntryBody) => Promise<EntryBodyUpdate>;
  /** Applies the replacements in order and saves the body only when all of them succeed. Requires scope: `entries:write`. */
  editBody: (id: string, input: EditEntryBody) => Promise<EntryBodyUpdate>;
  /** Deletes an entry. Requires scope: `entries:write`. */
  remove: (id: string) => Promise<void>;
}

export function useEntryMutations(): EntryMutations {
  const { client } = useMiloaContext();
  return useMemo(
    () => ({
      create: (input: CreateEntry) => client.request('entries.create', input),
      update: (id: string, update: UpdateEntry) =>
        client.request('entries.update', { id, update }),
      replaceBody: (id: string, input: ReplaceEntryBody) => client.request('entries.replace_body', { ...input, id }),
      editBody: (id: string, input: EditEntryBody) => client.request('entries.edit_body', { ...input, id }),
      remove: (id: string) => client.request('entries.delete', { id }).then(() => undefined),
    }),
    [client],
  );
}

/** Returns a function that opens an entry in the host's right pane. Requires scope: `ui:navigate`. */
export function useOpenEntry(): (entryId: string) => void {
  const { client } = useMiloaContext();
  return useCallback(
    (entryId: string) => {
      client.request('ui.open_entry', { entry_id: entryId }).catch((error: unknown) => {
        console.error('@comnipl/miloa-plugin-sdk: ui.open_entry failed', error);
      });
    },
    [client],
  );
}

/**
 * Draft config for settings mode. `setDraft` updates local state and at the same time
 * sends it to the host with `view.set_draft_config` (the host's save button saves it to the view).
 * So that the host has a draft even when the user saves without touching the settings UI,
 * the initial value is also sent once on mount.
 */
export function useDraftConfig<T>(initial: T): [T, (next: T) => void] {
  const { client } = useMiloaContext();
  const [draft, setDraftState] = useState(initial);

  const send = useCallback(
    (config: unknown) => {
      client.request('view.set_draft_config', { config }).catch((error: unknown) => {
        console.error('@comnipl/miloa-plugin-sdk: view.set_draft_config failed', error);
      });
    },
    [client],
  );

  const sentInitialRef = useRef(false);
  useEffect(() => {
    if (sentInitialRef.current) return;
    sentInitialRef.current = true;
    send(draft);
  }, [send, draft]);

  const setDraft = useCallback(
    (next: T) => {
      setDraftState(next);
      send(next);
    },
    [send],
  );
  return [draft, setDraft];
}
