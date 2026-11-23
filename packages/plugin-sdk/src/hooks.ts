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
  /** View に保存されたプラグイン設定。config_changed イベントで更新される。 */
  config: unknown;
  baseFilter: FilterNode | null;
  baseSort: EntrySort | null;
  /** 現在のテーマ。theme_changed イベントで更新される。 */
  theme: PluginTheme;
  permissions: GrantedPermissions;
}

/** frame の初期化情報と、テーマ・設定の現在値を返す。 */
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

/** `spec` が null の間は登録しない。`spec.tag_ids` が null なら全エントリを待ち受ける。 */
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
  /** 現在の引数で最後に読んだ件数。未取得なら null。 */
  counts: EntryCounts | null;
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * エントリの総件数とタグごとの件数 (`entries.counts`)。
 * params の変更 (JSON 比較) と待ち受けの通知で再取得する。`live: false` で待ち受けを止める。
 * `params` が null か `opts.enabled` が false の間は取得せず、`counts` を null に戻す。要 scope: `entries:read`。
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
  /** 現在の引数で最後に読んだページ。未取得なら null。件数 (`count: true`) は `page.count` にある。 */
  page: EntryPage | null;
  entries: readonly Entry[];
  /** 続きを読むときに `params.cursor` に渡す。null なら最後のページ。 */
  nextCursor: string | null;
  /** 現在の引数で最初の結果かエラーを待つ間は true。 */
  loading: boolean;
  /** 同じ引数で結果かエラーを返したあとに読み直す間は true。その間も前の結果とエラーを返す。 */
  refreshing: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * エントリ検索 (`entries.search`) の 1 ページ。`params.limit` を省くと
 * `ENTRY_SEARCH_PAGE_SIZE` 件まで取る。ページは件数が少なくても、0 件でも `nextCursor` を
 * 持ちうるので、続きの有無は `nextCursor` だけで判断する。一致する全件が要るなら `useAllEntries` を使う。
 * params の変更 (JSON 比較) と待ち受けの通知で再取得する。`live: false` で待ち受けを止める。
 * `params` が null か `opts.enabled` が false の間は取得せず、空の結果に戻す。要 scope: `entries:read`。
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
 * `useAllEntries` の検索条件。`limit` / `cursor` は hook がページングに使い、`count` は受け取らない。
 */
export type AllEntriesParams = Omit<SearchEntries, 'limit' | 'cursor' | 'count'>;

export interface UseAllEntriesResult {
  entries: readonly Entry[];
  /** 現在の引数で最初の結果かエラーを待つ間は true。 */
  loading: boolean;
  /** 同じ引数で結果かエラーを返したあとに読み直す間は true。その間も前の結果とエラーを返す。 */
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
 * 一致するエントリの全件を、`nextCursor` が null になるまでページを順に読んで返す。
 * 全ページが揃うまで、`entries` は現在の引数で最後に取得した全件を返す。未取得なら空になる。
 * 再取得の契機と `enabled` は `useEntrySearch` と同じ。要 scope: `entries:read`。
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
  /** 現在の引数で最初の結果かエラーを待つ間は true。 */
  loading: boolean;
  /** 同じ引数で結果かエラーを返したあとに読み直す間は true。その間も前の結果とエラーを返す。 */
  refreshing: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * エントリ 1 件の取得 (`entries.get`)。`id` が null の間は取得せず、null へ戻した
 * とき (選択解除など) は `entry: null` にリセットされる。既定で変更を待ち受ける。
 * 要 scope: `entries:read`。
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
  /** 最初の結果かエラーを待つ間は true。 */
  loading: boolean;
  /** 結果かエラーを返したあとに読み直す間は true。その間も前の結果とエラーを返す。 */
  refreshing: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * タグ一覧 (`tags.list`)。`tags_changed` で自動再取得する。
 * `live: false` で自動再取得を止める。要 scope: `tags:read`。
 */
export function useTags(opts: { live?: boolean } = {}): UseTagsResult {
  const { client } = useMiloaContext();
  const list = useCallback(() => client.request('tags.list'), [client]);
  const { data: tags, loading, refreshing, error, refetch } = useLiveRequest<readonly Tag[]>(list, EMPTY_LIST, opts.live === false ? null : 'tags');
  return { tags, loading, refreshing, error, refetch };
}

export interface EntryMutations {
  /** エントリ作成。答えは `entries.get` が読むのと同じ形のエントリ。要 scope: `entries:write`。 */
  create: (input: CreateEntry) => Promise<Entry>;
  /**
   * タイトル、タグ、フィールドを revision なしで更新する。`add_tag_ids` と `remove_tag_ids` でタグを付け外しし、
   * `field_values` の `null` は値を消す。答えの `revision` はこの更新が書いた版。要 scope: `entries:write`。
   */
  update: (id: string, update: UpdateEntry) => Promise<EntryUpdate>;
  /** 本文の revision が一致するときに本文を置き換える。要 scope: `entries:write`。 */
  replaceBody: (id: string, input: ReplaceEntryBody) => Promise<EntryBodyUpdate>;
  /** 順に置換し、全件が成功したときだけ本文を保存する。要 scope: `entries:write`。 */
  editBody: (id: string, input: EditEntryBody) => Promise<EntryBodyUpdate>;
  /** エントリ削除。要 scope: `entries:write`。 */
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

/** ホストの右ペインでエントリを開く関数を返す。要 scope: `ui:navigate`。 */
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
 * settings モード用のドラフト設定。`setDraft` はローカル state の更新と同時に
 * `view.set_draft_config` でホストへ送る (ホストの保存ボタンがこれを View に保存する)。
 * ユーザーが設定 UI を一切触らずに保存してもホストがドラフトを持てるよう、
 * マウント時に初期値も 1 回送られる。
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
