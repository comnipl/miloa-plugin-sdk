/**
 * Low-level client that does not depend on React. It hides the handshake with the host and the
 * MessagePort RPC. React plugins can use definePlugin from `@comnipl/miloa-plugin-sdk/react`;
 * only plugins that do not use React use this directly.
 */

import {
  FRAME_READY_MESSAGE_TYPE,
  INIT_MESSAGE_TYPE,
  PROTOCOL_FEATURES,
  PROTOCOL_VERSION,
  RPC_ERROR_CODES,
  type FrameReadyMessage,
  type InitPayload,
  type PluginHostEventName,
  type PluginHostEventPayloads,
  type PluginRpcMethod,
  type PluginRpcParams,
  type PluginRpcResult,
  type PluginTheme,
  type RpcRequest,
} from '@comnipl/miloa-plugin-contract';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;

/** Error that rejects an RPC when it fails with an error response, a timeout, or a disconnect. */
export class PluginRpcError extends Error {
  /** Known values are the protocol's `RpcErrorCode` (such as `permission_denied`). */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PluginRpcError';
    this.code = code;
  }
}

/**
 * Minimal set of window APIs that createPluginClient uses.
 * It is injectable so that tests on Node can fake the host.
 */
export interface PluginClientWindow {
  parent: { postMessage(message: unknown, targetOrigin: string): void };
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  document?: {
    readyState: string;
    addEventListener(
      type: 'DOMContentLoaded',
      listener: () => void,
      options?: { once: boolean },
    ): void;
  };
}

export interface PluginClientOptions {
  /** Time to wait for an RPC response, in ms. Defaults to 30000. */
  requestTimeoutMs?: number;
  /** Time to wait for `miloa:init`, in ms. Defaults to 10000. Rejects when exceeded. */
  handshakeTimeoutMs?: number;
  /** For tests. Defaults to the global window. */
  windowRef?: PluginClientWindow;
}

/** Plugin client connected to the host. */
export interface PluginClient {
  /** Init data received in `miloa:init` (permissions, theme, view config, and more). */
  readonly init: InitPayload;
  /**
   * Calls an RPC once. Rejects with `PluginRpcError` on missing permissions or a timeout.
   * For methods that take no params (such as `tags.list`), you can omit the second argument.
   */
  request<M extends PluginRpcMethod>(
    method: M,
    ...args: PluginRpcParams<M> extends null ? [params?: null] : [params: PluginRpcParams<M>]
  ): Promise<PluginRpcResult<M>>;
  /** Subscribes to a host event. Call the returned function to unsubscribe. */
  on<E extends PluginHostEventName>(
    name: E,
    handler: (payload: PluginHostEventPayloads[E]) => void,
  ): () => void;
  /** Subscribes to `theme_changed` (a thin alias of `on`). Call the returned function to unsubscribe. */
  onThemeChange(handler: (theme: PluginTheme) => void): () => void;
  /** Closes the port. Rejects all pending requests. */
  close(): void;
}

/**
 * Performs the handshake with the host (`miloa:frame-ready` → `miloa:init`) and
 * resolves to a connected {@link PluginClient}. Call it once per frame.
 */
export function createPluginClient(options: PluginClientOptions = {}): Promise<PluginClient> {
  const win: PluginClientWindow = options.windowRef ?? window;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    // Put a deadline on the handshake so that the listener and the Promise do not stay forever
    // when init never arrives. definePlugin's catch picks this up and shows the error in the frame
    const handshakeTimer = setTimeout(() => {
      win.removeEventListener('message', onMessage);
      reject(
        new Error(
          `@comnipl/miloa-plugin-sdk: handshake timed out after ${handshakeTimeoutMs}ms ` +
            `waiting for ${INIT_MESSAGE_TYPE}; is this frame embedded by a miloa host?`,
        ),
      );
    }, handshakeTimeoutMs);

    const onMessage = (event: MessageEvent): void => {
      // Reject fake init messages from anything other than the parent, such as sibling frames
      if (event.source !== win.parent) return;
      const data: unknown = event.data;
      if (!isInitMessage(data)) return;
      const port = event.ports[0];
      if (!port) return;
      win.removeEventListener('message', onMessage);
      clearTimeout(handshakeTimer);
      const init = parseInitPayload(data.payload);
      if (init instanceof Error) {
        port.close();
        reject(init);
        return;
      }
      resolve(connect(init, port, timeoutMs));
    };
    win.addEventListener('message', onMessage);

    whenDocumentReady(win, () => {
      // An opaque origin cannot state its own origin, so targetOrigin has to be '*'.
      // Do not include secrets
      const ready: FrameReadyMessage = {
        type: FRAME_READY_MESSAGE_TYPE,
        protocol_version: PROTOCOL_VERSION,
      };
      win.parent.postMessage(ready, '*');
    });
  });
}

/** The frame HTML's script runs synchronously at the end of body, but this keeps it working when loaded with defer or similar. */
function whenDocumentReady(win: PluginClientWindow, callback: () => void): void {
  const doc = win.document;
  if (doc && doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', callback, { once: true });
  } else {
    callback();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function hostFeatureError(
  hostMinor: number, key: PluginRpcMethod | PluginHostEventName, params?: unknown,
): PluginRpcError | null {
  const prefix = `${key}:`;
  const unsupported = Object.entries(PROTOCOL_FEATURES).find(([feature, minor]) => {
    if (minor <= hostMinor) return false;
    if (feature === key) return true;
    if (!feature.startsWith(prefix)) return false;
    return feature.slice(prefix.length).split('.').reduce<unknown>(
      (value, field) => isRecord(value) && Object.prototype.hasOwnProperty.call(value, field) ? value[field] : undefined,
      params,
    ) !== undefined;
  });
  if (unsupported === undefined) return null;
  const [feature, minor] = unsupported;
  const { major } = PROTOCOL_VERSION;
  return new PluginRpcError(
    RPC_ERROR_CODES.hostOutdated,
    `This miloa tab speaks plugin protocol ${major}.${hostMinor} and does not support ${feature} ` +
      `(introduced in ${major}.${minor}). Reload the page.`,
  );
}

function isInitMessage(
  data: unknown,
): data is { type: typeof INIT_MESSAGE_TYPE; payload: Record<string, unknown> } {
  return isRecord(data) && data.type === INIT_MESSAGE_TYPE && isRecord(data.payload);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Runtime validation of the init payload. It is not a security check, because the sender is the
 * parent whose source is already verified (the trusted host). When the host and SDK versions differ
 * and the shapes do not match, it fails clearly at handshake time instead of breaking obscurely deep inside on undefined.
 */
function parseInitPayload(payload: Record<string, unknown>): InitPayload | Error {
  const version = payload.protocol_version;
  if (!isRecord(version) || version.major !== PROTOCOL_VERSION.major
    || typeof version.minor !== 'number' || !Number.isInteger(version.minor) || version.minor < 0) {
    const received = isRecord(version) ? `${String(version.major)}.${String(version.minor)}` : String(version);
    return new Error(
      `@comnipl/miloa-plugin-sdk: unsupported protocol version ` +
        `${received} (expected major ${PROTOCOL_VERSION.major}); ` +
        `update the plugin SDK or the miloa host`,
    );
  }
  const malformed = (reason: string): Error =>
    new Error(
      `@comnipl/miloa-plugin-sdk: malformed ${INIT_MESSAGE_TYPE} payload (${reason}); ` +
        `update the plugin SDK or the miloa host`,
    );
  if (typeof payload.plugin_id !== 'string') return malformed('plugin_id must be a string');
  if (payload.view_id !== null && typeof payload.view_id !== 'string') {
    return malformed('view_id must be a string or null');
  }
  if (payload.mode !== 'view' && payload.mode !== 'settings') {
    return malformed(`mode must be 'view' or 'settings'`);
  }
  if (payload.theme !== 'dark' && payload.theme !== 'light') {
    return malformed(`theme must be 'dark' or 'light'`);
  }
  if (payload.base_filter !== null && !isRecord(payload.base_filter)) {
    return malformed('base_filter must be an object or null');
  }
  if (payload.base_sort !== null && !isRecord(payload.base_sort)) {
    return malformed('base_sort must be an object or null');
  }
  const permissions = payload.granted_permissions;
  if (!isRecord(permissions) || !isStringArray(permissions.api)) {
    return malformed('granted_permissions.api must be an array of strings');
  }
  return payload as unknown as InitPayload;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function connect(init: InitPayload, port: MessagePort, timeoutMs: number): PluginClient {
  let nextId = 1;
  let closed = false;
  const pending = new Map<number, PendingRequest>();
  const listeners = new Map<PluginHostEventName, Set<(payload: unknown) => void>>();

  function teardown(reason: string): void {
    if (closed) return;
    closed = true;
    port.onmessage = null;
    port.close();
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new PluginRpcError(RPC_ERROR_CODES.internal, reason));
    }
    pending.clear();
    listeners.clear();
  }

  // Assigning onmessage also calls port.start() (same behavior on Web and Node)
  port.onmessage = (event: MessageEvent) => {
    handleMessage(event.data);
  };

  // When the host closes the port (for example, it disposes only the dispatcher and keeps the frame),
  // reject pending requests at once instead of leaving them until the timeout. The MessagePort
  // close event is a relatively new spec, so environments that do not fire it fall back to the timeout
  port.addEventListener(
    'close',
    () => {
      teardown('plugin host disconnected');
    },
    { once: true },
  );

  function handleMessage(data: unknown): void {
    if (!isRecord(data) || data.v !== PROTOCOL_VERSION.major) return;
    if (data.kind === 'response') {
      if (typeof data.id !== 'number' || typeof data.ok !== 'boolean') return;
      const entry = pending.get(data.id);
      // Late responses to requests that already timed out or were closed are dropped here too
      if (!entry) return;
      pending.delete(data.id);
      clearTimeout(entry.timer);
      if (data.ok) {
        entry.resolve(data.result);
      } else {
        const error = isRecord(data.error) ? data.error : {};
        entry.reject(
          new PluginRpcError(
            typeof error.code === 'string' ? error.code : RPC_ERROR_CODES.internal,
            typeof error.message === 'string' ? error.message : 'rpc request failed',
          ),
        );
      }
      return;
    }
    if (data.kind === 'event') {
      if (typeof data.name !== 'string') return;
      const set = listeners.get(data.name as PluginHostEventName);
      if (!set) return;
      // Call handlers on a copy so that unsubscribing inside a handler does not break the iteration
      for (const handler of [...set]) handler(data.payload);
    }
  }

  function request<M extends PluginRpcMethod>(
    method: M,
    ...args: PluginRpcParams<M> extends null ? [params?: null] : [params: PluginRpcParams<M>]
  ): Promise<PluginRpcResult<M>> {
    // Normalize an omitted call to a method without params (`request('tags.list')`) to null.
    // For methods that require params, the types do not allow a nullish argument
    const params: unknown = args[0] ?? null;
    return new Promise((resolve, reject) => {
      if (closed) {
        reject(new PluginRpcError(RPC_ERROR_CODES.internal, 'plugin client is closed'));
        return;
      }
      const error = hostFeatureError(init.protocol_version.minor, method, params);
      if (error !== null) {
        reject(error);
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new PluginRpcError(RPC_ERROR_CODES.internal, `rpc request timed out: ${method}`),
        );
      }, timeoutMs);
      pending.set(id, { resolve: resolve as (result: unknown) => void, reject, timer });
      const message: RpcRequest = { v: PROTOCOL_VERSION.major, kind: 'request', id, method, params };
      port.postMessage(message);
    });
  }

  function on<E extends PluginHostEventName>(
    name: E,
    handler: (payload: PluginHostEventPayloads[E]) => void,
  ): () => void {
    const error = hostFeatureError(init.protocol_version.minor, name);
    if (error !== null) throw error;
    let set = listeners.get(name);
    if (!set) {
      set = new Set();
      listeners.set(name, set);
    }
    const entry = handler as (payload: unknown) => void;
    set.add(entry);
    return () => {
      set.delete(entry);
    };
  }

  function close(): void {
    teardown('plugin client closed');
  }

  return {
    init,
    request,
    on,
    onThemeChange(handler) {
      return on('theme_changed', (payload) => {
        // Do not throw a TypeError when a host/SDK version mismatch gives the payload an unexpected shape
        if (!isRecord(payload)) return;
        if (payload.theme !== 'dark' && payload.theme !== 'light') return;
        handler(payload.theme);
      });
    },
    close,
  };
}
