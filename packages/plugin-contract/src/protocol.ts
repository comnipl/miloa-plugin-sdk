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
 * Maximum number of entries in one `entries.search` page. A page can have fewer entries,
 * or none, and still have a `next_cursor`, so use only `next_cursor` to decide whether more pages follow.
 */
export const ENTRY_SEARCH_PAGE_SIZE = 500;

/** Maximum number of watches that one frame (MessagePort) can hold at the same time. */
export const MAX_WATCHES_PER_FRAME = 64;

/** Maximum number of tags that one watch can list in `tag_ids`. */
export const MAX_WATCH_TAG_IDS = 256;

export type PluginTheme = 'dark' | 'light';

/** What the frame is for. `view` is the view itself; `settings` is the settings UI in the view settings pane. */
export type PluginFrameMode = 'view' | 'settings';

/** Permissions that the user approved at install time. */
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
  /** `null` when, for example, the view is not saved yet in settings mode. */
  view_id: string | null;
  mode: PluginFrameMode;
  /** Plugin settings saved on the view (opaque). */
  config: unknown;
  /** Search criteria saved on the view. */
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
  /** `outerHTML` of the root element to print. */
  html: string;
  /** CSS text serialized from the style sheets active in the frame. `@page` rules apply as is. */
  css: string;
  /** Title of the print job. Used, for example, as the default file name when saving as PDF. */
  title?: string;
}

/** Draft view config that the settings screen uses when it saves. */
export interface ViewSetDraftConfigParams {
  config: unknown;
}

/** Height of the content to show in the settings screen, in CSS pixels. */
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
 * Permission that a method call requires.
 * The scope must be in `granted_permissions.api`.
 * `null` means no permission is required.
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
  /** Returned by the SDK before it uses a feature that the host does not know. */
  hostOutdated: 'host_outdated',
} as const;

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[keyof typeof RPC_ERROR_CODES];

export interface RpcErrorShape {
  /** Known values are `RpcErrorCode`. Receivers treat it as a string, because more codes may be added. */
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
  /** `entry_ids: null` means it is unknown which entries changed, so read them again. */
  'watch_changed': { watch_id: string; entry_ids: readonly string[] | null };
  /** `tag_ids: null` means it is unknown which tags changed during a resync. */
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

/** Permission required to receive the event. `null` means no permission is required. */
export const EVENT_SCOPES: Record<PluginHostEventName, PluginApiScope | null> = {
  'watch_changed': 'entries:read',
  'tags_changed': 'tags:read',
  'theme_changed': null,
  'config_changed': null,
};

/** Minor version that added each feature. Name an optional request field as `method:path.to.field`. */
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
