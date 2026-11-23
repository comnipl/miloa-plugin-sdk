/**
 * React 非依存の低レベルクライアント。ホストとのハンドシェイクと MessagePort RPC を
 * 隠蔽する。React プラグインは `@comnipl/miloa-plugin-sdk/react` の definePlugin を使えばよく、
 * これを直接触るのは React を使わないプラグインだけ。
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

/** RPC がエラー応答・タイムアウト・切断で失敗したときに reject される Error。 */
export class PluginRpcError extends Error {
  /** 既知の値は protocol の `RpcErrorCode` (`permission_denied` など)。 */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PluginRpcError';
    this.code = code;
  }
}

/**
 * createPluginClient が触る window API の最小集合。
 * node 上のテストでホスト役を偽装できるよう注入可能にしている。
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
  /** RPC 応答を待つ時間 (ms)。既定 30000。 */
  requestTimeoutMs?: number;
  /** `miloa:init` を待つ時間 (ms)。既定 10000。超過すると reject される。 */
  handshakeTimeoutMs?: number;
  /** テスト用。既定はグローバルの window。 */
  windowRef?: PluginClientWindow;
}

/** ホストと接続済みのプラグインクライアント。 */
export interface PluginClient {
  /** `miloa:init` で受け取った初期化情報 (権限・テーマ・View 設定など)。 */
  readonly init: InitPayload;
  /**
   * RPC を 1 回呼ぶ。権限不足やタイムアウトは `PluginRpcError` で reject される。
   * params を取らないメソッド (`tags.list` 等) は第 2 引数を省略できる。
   */
  request<M extends PluginRpcMethod>(
    method: M,
    ...args: PluginRpcParams<M> extends null ? [params?: null] : [params: PluginRpcParams<M>]
  ): Promise<PluginRpcResult<M>>;
  /** ホストイベントを購読する。返り値の関数で購読解除。 */
  on<E extends PluginHostEventName>(
    name: E,
    handler: (payload: PluginHostEventPayloads[E]) => void,
  ): () => void;
  /** `theme_changed` の購読 (on の薄い別名)。返り値の関数で購読解除。 */
  onThemeChange(handler: (theme: PluginTheme) => void): () => void;
  /** ポートを閉じる。保留中のリクエストは全て reject される。 */
  close(): void;
}

/**
 * ホストとのハンドシェイク (`miloa:frame-ready` → `miloa:init`) を行い、
 * 接続済みの {@link PluginClient} を resolve する。frame 内で 1 度だけ呼ぶ。
 */
export function createPluginClient(options: PluginClientOptions = {}): Promise<PluginClient> {
  const win: PluginClientWindow = options.windowRef ?? window;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    // init 不達のまま listener と Promise が永久に残らないよう、ハンドシェイクには
    // 期限を切る。definePlugin の catch がこれを拾い frame 内にエラーを表示できる
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
      // 兄弟 frame など親以外からの偽 init を受け付けない
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
      // opaque origin からは自分の origin を表明できないため targetOrigin は '*' が
      // 不可避。秘匿情報は載せない
      const ready: FrameReadyMessage = {
        type: FRAME_READY_MESSAGE_TYPE,
        protocol_version: PROTOCOL_VERSION,
      };
      win.parent.postMessage(ready, '*');
    });
  });
}

/** frame HTML の script は body 末尾で同期実行されるが、defer 等で読まれても壊れないように。 */
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
 * init payload の runtime 検証。送信者は source 検証済みの親 (信頼できるホスト) なので
 * 攻撃対策ではなく、ホストと SDK のバージョン乖離で形が食い違ったとき、undefined の
 * まま深部で不可解に壊れるのではなくハンドシェイク時点で明確に失敗させるための検査。
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

  // onmessage への代入が port.start() を兼ねる (Web / Node 共通の挙動)
  port.onmessage = (event: MessageEvent) => {
    handleMessage(event.data);
  };

  // ホスト側が port を閉じたら (frame を残したままディスパッチャだけ破棄された等)、
  // 保留中のリクエストをタイムアウトまで放置せず即座に reject する。MessagePort の
  // close イベントは比較的新しい仕様のため、未発火の環境ではタイムアウトに任せる
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
      // タイムアウト済み・close 済みのリクエストへの遅れた応答もここで捨てる
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
      // ハンドラ内での購読解除がイテレーションを壊さないようコピーして呼ぶ
      for (const handler of [...set]) handler(data.payload);
    }
  }

  function request<M extends PluginRpcMethod>(
    method: M,
    ...args: PluginRpcParams<M> extends null ? [params?: null] : [params: PluginRpcParams<M>]
  ): Promise<PluginRpcResult<M>> {
    // params 無しメソッドの省略呼び出し (`request('tags.list')`) は null に正規化する。
    // params が必須のメソッドの実引数に nullish は型上存在しない
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
        // ホスト/SDK のバージョン乖離で payload が想定外の形でも TypeError で落とさない
        if (!isRecord(payload)) return;
        if (payload.theme !== 'dark' && payload.theme !== 'light') return;
        handler(payload.theme);
      });
    },
    close,
  };
}
