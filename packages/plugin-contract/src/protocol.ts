import type {
  CountEntries,
  CreateEntry,
  EditEntryBody,
  Entry,
  EntryBodyUpdate,
  EntryCounts,
  EntryPage,
  EntrySort,
  EntryUpdate,
  FilterNode,
  ReplaceEntryBody,
  SearchEntries,
  Tag,
  UpdateEntry,
} from './data';
import type { PluginApiScope } from './manifest';

export const PROTOCOL_VERSION = { major: 4, minor: 0 } as const;

export interface ProtocolVersion {
  major: number;
  minor: number;
}

/**
 * `entries.search` の 1 ページの最大件数。ページはこれより少ない件数や
 * 0 件でも `next_cursor` を持ちうるので、続きの有無は `next_cursor` だけで判断する。
 */
export const ENTRY_SEARCH_PAGE_SIZE = 500;

/** 1 つの frame (MessagePort) が同時に持てる待ち受けの数。 */
export const MAX_WATCHES_PER_FRAME = 64;

/** 1 つの待ち受けの `tag_ids` に指定できるタグの数。 */
export const MAX_WATCH_TAG_IDS = 256;

export type PluginTheme = 'dark' | 'light';

/** frame の用途。`view` は View 本体、`settings` は View 設定ペイン内の設定 UI。 */
export type PluginFrameMode = 'view' | 'settings';

/** インストール時にユーザーが承認した権限。 */
export interface GrantedPermissions {
  api: PluginApiScope[];
}

export const FRAME_READY_MESSAGE_TYPE = 'miloa:frame-ready';
export const FRAME_ERROR_MESSAGE_TYPE = 'miloa:frame-error';
export const INIT_MESSAGE_TYPE = 'miloa:init';

export interface FrameReadyMessage {
  type: typeof FRAME_READY_MESSAGE_TYPE;
  protocol_version: ProtocolVersion;
}

export interface FrameErrorMessage {
  type: typeof FRAME_ERROR_MESSAGE_TYPE;
  message: string;
}

export interface InitMessage {
  type: typeof INIT_MESSAGE_TYPE;
  payload: InitPayload;
}

export interface InitPayload {
  protocol_version: ProtocolVersion;
  plugin_id: string;
  /** settings モードで View が未保存の場合などは null。 */
  view_id: string | null;
  mode: PluginFrameMode;
  /** View に保存されたプラグイン設定 (opaque)。 */
  config: unknown;
  /** View に保存された検索条件。 */
  base_filter: FilterNode | null;
  base_sort: EntrySort | null;
  theme: PluginTheme;
  granted_permissions: GrantedPermissions;
}

export interface EntryIdParams {
  id: string;
}

export interface EntryUpdateParams {
  id: string;
  update: UpdateEntry;
}

export interface ReplaceEntryBodyParams extends ReplaceEntryBody {
  id: string;
}

export interface EditEntryBodyParams extends EditEntryBody {
  id: string;
}

export interface UiOpenEntryParams {
  entry_id: string;
}

export interface UiPrintParams {
  /** 印刷対象ルート要素の outerHTML。 */
  html: string;
  /** frame で適用中のスタイルシートを直列化した CSS テキスト。`@page` もそのまま効く。 */
  css: string;
  /** 印刷ジョブの表題。PDF 保存時の既定ファイル名などに使われる。 */
  title?: string;
}

/** 設定画面で保存するときに使う View のドラフト設定。 */
export interface ViewSetDraftConfigParams {
  config: unknown;
}

/** 設定画面に表示するコンテンツの高さ (CSS ピクセル)。 */
export interface ViewSetContentHeightParams {
  height: number;
}

export interface PluginRpcSchema {
  'entries.search': { params: SearchEntries; result: EntryPage };
  'entries.get': { params: EntryIdParams; result: Entry };
  'entries.counts': { params: CountEntries; result: EntryCounts };
  'entries.create': { params: CreateEntry; result: Entry };
  'entries.update': { params: EntryUpdateParams; result: EntryUpdate };
  'entries.replace_body': { params: ReplaceEntryBodyParams; result: EntryBodyUpdate };
  'entries.edit_body': { params: EditEntryBodyParams; result: EntryBodyUpdate };
  'entries.delete': { params: EntryIdParams; result: null };
  'events.watch': { params: { tag_ids: readonly string[] | null }; result: { watch_id: string } };
  'events.unwatch': { params: { watch_id: string }; result: null };
  'tags.list': { params: null; result: readonly Tag[] };
  'ui.open_entry': { params: UiOpenEntryParams; result: null };
  'ui.print': { params: UiPrintParams; result: null };
  'view.set_draft_config': { params: ViewSetDraftConfigParams; result: null };
  'view.set_content_height': { params: ViewSetContentHeightParams; result: null };
}

export type PluginRpcMethod = keyof PluginRpcSchema;

export type PluginRpcParams<M extends PluginRpcMethod> = PluginRpcSchema[M]['params'];
export type PluginRpcResult<M extends PluginRpcMethod> = PluginRpcSchema[M]['result'];

export const PLUGIN_RPC_METHODS = [
  'entries.search',
  'entries.get',
  'entries.counts',
  'entries.create',
  'entries.update',
  'entries.replace_body',
  'entries.edit_body',
  'entries.delete',
  'events.watch',
  'events.unwatch',
  'tags.list',
  'ui.open_entry',
  'ui.print',
  'view.set_draft_config',
  'view.set_content_height',
] as const satisfies readonly PluginRpcMethod[];

/**
 * メソッド呼び出しに必要な権限。
 * scope は `granted_permissions.api` に含まれている必要がある。
 * `null` は権限不要。
 */
export const METHOD_SCOPES: Record<PluginRpcMethod, PluginApiScope | null> = {
  'entries.search': 'entries:read',
  'entries.get': 'entries:read',
  'entries.counts': 'entries:read',
  'entries.create': 'entries:write',
  'entries.update': 'entries:write',
  'entries.replace_body': 'entries:write',
  'entries.edit_body': 'entries:write',
  'entries.delete': 'entries:write',
  'events.watch': 'entries:read',
  'events.unwatch': null,
  'tags.list': 'tags:read',
  'ui.open_entry': 'ui:navigate',
  'ui.print': 'ui:print',
  'view.set_draft_config': null,
  'view.set_content_height': null,
};

export const RPC_ERROR_CODES = {
  permissionDenied: 'permission_denied',
  unknownMethod: 'unknown_method',
  apiError: 'api_error',
  internal: 'internal',
  /** SDK が、ホストの知らない機能を使う前に返す。 */
  hostOutdated: 'host_outdated',
} as const;

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[keyof typeof RPC_ERROR_CODES];

export interface RpcErrorShape {
  /** 既知の値は `RpcErrorCode`。将来のコード追加に備え受信側は string として扱う。 */
  code: string;
  message: string;
}

export interface RpcRequest {
  v: typeof PROTOCOL_VERSION.major;
  kind: 'request';
  id: number;
  method: PluginRpcMethod;
  params: unknown;
}

export interface RpcSuccessResponse {
  v: typeof PROTOCOL_VERSION.major;
  kind: 'response';
  id: number;
  ok: true;
  result: unknown;
}

export interface RpcErrorResponse {
  v: typeof PROTOCOL_VERSION.major;
  kind: 'response';
  id: number;
  ok: false;
  error: RpcErrorShape;
}

export type RpcResponse = RpcSuccessResponse | RpcErrorResponse;

export interface PluginHostEventPayloads {
  /** `entry_ids: null` はどのエントリが変わったか不明で、読み直しが必要。 */
  'watch_changed': { watch_id: string; entry_ids: readonly string[] | null };
  /** `tag_ids: null` は再同期時にどのタグが変わったか分からないことを表す。 */
  'tags_changed': { tag_ids: readonly string[] | null };
  'theme_changed': { theme: PluginTheme };
  'config_changed': { config: unknown };
}

export type PluginHostEventName = keyof PluginHostEventPayloads;

export const PLUGIN_HOST_EVENT_NAMES = [
  'watch_changed',
  'tags_changed',
  'theme_changed',
  'config_changed',
] as const satisfies readonly PluginHostEventName[];

/** イベントを受信するために必要な権限。`null` は権限不要。 */
export const EVENT_SCOPES: Record<PluginHostEventName, PluginApiScope | null> = {
  'watch_changed': 'entries:read',
  'tags_changed': 'tags:read',
  'theme_changed': null,
  'config_changed': null,
};

/** 機能が入った minor。要求の任意のフィールドは `method:path.to.field` で指定する。 */
export const PROTOCOL_FEATURES = {
  'entries.search': 0,
  'entries.get': 0,
  'entries.counts': 0,
  'entries.create': 0,
  'entries.update': 0,
  'entries.replace_body': 0,
  'entries.edit_body': 0,
  'entries.delete': 0,
  'events.watch': 0,
  'events.unwatch': 0,
  'tags.list': 0,
  'ui.open_entry': 0,
  'ui.print': 0,
  'view.set_draft_config': 0,
  'view.set_content_height': 0,
  'watch_changed': 0,
  'tags_changed': 0,
  'theme_changed': 0,
  'config_changed': 0,
} satisfies Record<PluginRpcMethod | PluginHostEventName, number> & Partial<Record<`${PluginRpcMethod}:${string}`, number>>;

export interface RpcEvent {
  v: typeof PROTOCOL_VERSION.major;
  kind: 'event';
  name: PluginHostEventName;
  payload: unknown;
}

export type RpcMessage = RpcRequest | RpcResponse | RpcEvent;
