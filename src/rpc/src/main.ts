import type {
  RpcAck,
  RpcMessage,
  RpcRequest,
  RpcResponse,
  RpcStreamEnd,
  RpcStreamError,
  RpcStreamNext,
} from "./messages";
import type { ArgumentsType, ReturnType, Thenable } from "./utils";
import {
  TYPE_ACK,
  TYPE_REQUEST,
  TYPE_RESPONSE,
  TYPE_STREAM_END,
  TYPE_STREAM_ERROR,
  TYPE_STREAM_NEXT,
} from "./messages";
import { createPromiseWithResolvers, isAsyncIterable, nanoid } from "./utils";

export type PromisifyFn<T> =
  ReturnType<T> extends Promise<any>
    ? T
    : (...args: ArgumentsType<T>) => Promise<Awaited<ReturnType<T>>>;

export type BirpcResolver<This> = (
  this: This,
  name: string,
  resolved: (...args: unknown[]) => unknown,
) => Thenable<((...args: any[]) => any) | undefined>;

export interface ChannelOptions {
  /**
   * Function to post raw message
   */
  post: (data: any, ...extras: any[]) => Thenable<any>;
  /**
   * Listener to receive raw message
   */
  on: (fn: (data: any, ...extras: any[]) => void) => Thenable<any>;
  /**
   * Clear the listener when `$close` is called
   */
  off?: (fn: (data: any, ...extras: any[]) => void) => Thenable<any>;
  /**
   * Custom function to serialize data
   *
   * by default it passes the data as-is
   */
  serialize?: (data: any) => any;
  /**
   * Custom function to deserialize data
   *
   * by default it passes the data as-is
   */
  deserialize?: (data: any) => any;

  /**
   * Call the methods with the RPC context or the original functions object
   */
  bind?: "rpc" | "functions";

  /**
   * Custom meta data to attached to the RPC instance's `$meta` property
   */
  meta?: any;
}

export interface EventOptions<
  RemoteFunctions extends object = Record<string, unknown>,
  LocalFunctions extends object = Record<string, unknown>,
  Proxify extends boolean = true,
> {
  /**
   * Names of remote functions that do not need response.
   */
  eventNames?: (keyof RemoteFunctions)[];

  /**
   * Maximum timeout for waiting for response, in milliseconds.
   *
   * @default 60_000
   */
  timeout?: number;

  /**
   * Whether to proxy the remote functions.
   *
   * When `proxify` is false, calling the remote function
   * with `rpc.$call('method', ...args)` instead of `rpc.method(...args)`
   * explicitly is required.
   *
   * @default true
   */
  proxify?: Proxify;

  /**
   * Custom resolver to resolve function to be called
   *
   * For advanced use cases only
   */
  resolver?: BirpcResolver<
    BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>
  >;

  /**
   * Hook triggered before an event is sent to the remote
   *
   * @param req - Request parameters
   * @param next - Function to continue the request
   * @param resolve - Function to resolve the response directly
   */
  onRequest?: (
    this: BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>,
    req: RpcRequest,
    next: (req?: RpcRequest) => Promise<any>,
    resolve: (res: any) => void,
  ) => void | Promise<void>;

  /**
   * Custom error handler for errors occurred in local functions being called
   *
   * @returns `true` to prevent the error from being thrown
   */
  onFunctionError?: (
    this: BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>,
    error: Error,
    functionName: string,
    args: any[],
  ) => boolean | void;

  /**
   * Custom error handler for errors occurred during serialization or messsaging
   *
   * @returns `true` to prevent the error from being thrown
   */
  onGeneralError?: (
    this: BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>,
    error: Error,
    functionName?: string,
    args?: any[],
  ) => boolean | void;

  /**
   * Custom error handler for timeouts
   *
   * @returns `true` to prevent the error from being thrown
   */
  onTimeoutError?: (
    this: BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>,
    functionName: string,
    args: any[],
  ) => boolean | void;

  /**
   * Timeout for receiving acknowledgment that message was received (ms).
   * If set, the receiver will send an ACK immediately upon receiving the request,
   * and the caller will reject if no ACK is received within this time.
   *
   * @default undefined (no ack required)
   */
  ackTimeout?: number;

  /**
   * Custom error handler for ack timeouts
   *
   * @returns `true` to prevent the error from being thrown
   */
  onAckTimeoutError?: (
    this: BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>,
    functionName: string,
    args: any[],
  ) => boolean | void;
}

export type BirpcOptions<
  RemoteFunctions extends object = Record<string, unknown>,
  LocalFunctions extends object = Record<string, unknown>,
  Proxify extends boolean = true,
> = EventOptions<RemoteFunctions, LocalFunctions, Proxify> & ChannelOptions;

/**
 * Extract the yielded type from an async iterable
 */
export type AsyncIterableYield<T> =
  T extends AsyncIterable<infer U> ? U : never;

export type BirpcFn<T> = PromisifyFn<T> & {
  /**
   * Send event without asking for response
   */
  asEvent: (...args: ArgumentsType<T>) => Promise<void>;
  /**
   * Call the function and return results as an async iterable stream
   */
  asStream: (
    ...args: ArgumentsType<T>
  ) => AsyncIterable<
    ReturnType<T> extends AsyncIterable<infer U> ? U : Awaited<ReturnType<T>>
  >;
};

export interface BirpcReturnBuiltin<
  RemoteFunctions,
  LocalFunctions = Record<string, unknown>,
> {
  /**
   * Raw functions object
   */
  $functions: LocalFunctions;
  /**
   * Whether the RPC is closed
   */
  readonly $closed: boolean;
  /**
   * Custom meta data attached to the RPC instance
   */
  readonly $meta: any;
  /**
   * Close the RPC connection
   */
  $close: (error?: Error) => void;
  /**
   * Reject pending calls
   */
  $rejectPendingCalls: (handler?: PendingCallHandler) => Promise<void>[];
  /**
   * Call the remote function and wait for the result.
   * An alternative to directly calling the function
   */
  $call: <K extends keyof RemoteFunctions>(
    method: K,
    ...args: ArgumentsType<RemoteFunctions[K]>
  ) => Promise<Awaited<ReturnType<RemoteFunctions[K]>>>;
  /**
   * Same as `$call`, but returns `undefined` if the function is not defined on the remote side.
   */
  $callOptional: <K extends keyof RemoteFunctions>(
    method: K,
    ...args: ArgumentsType<RemoteFunctions[K]>
  ) => Promise<Awaited<ReturnType<RemoteFunctions[K]> | undefined>>;
  /**
   * Send event without asking for response
   */
  $callEvent: <K extends keyof RemoteFunctions>(
    method: K,
    ...args: ArgumentsType<RemoteFunctions[K]>
  ) => Promise<void>;
  /**
   * Call the remote function with the raw options.
   */
  $callRaw: (options: {
    method: string;
    args: unknown[];
    event?: boolean;
    optional?: boolean;
  }) => Promise<Awaited<ReturnType<any>>[]>;
  /**
   * Call a remote function that returns an async iterator and stream the results.
   */
  $callStream: <K extends keyof RemoteFunctions>(
    method: K,
    ...args: ArgumentsType<RemoteFunctions[K]>
  ) => AsyncIterable<any>;
}

/**
 * Recursively proxify remote functions, supporting nested namespaces.
 * Functions become BirpcFn, nested objects become recursively proxified.
 */
export type ProxifiedRemoteFunctions<
  RemoteFunctions extends object = Record<string, unknown>,
> = {
  [K in keyof RemoteFunctions]: RemoteFunctions[K] extends (
    ...args: any[]
  ) => any
    ? BirpcFn<RemoteFunctions[K]>
    : RemoteFunctions[K] extends object
      ? ProxifiedRemoteFunctions<RemoteFunctions[K]>
      : BirpcFn<RemoteFunctions[K]>;
};

export type BirpcReturn<
  RemoteFunctions extends object = Record<string, unknown>,
  LocalFunctions extends object = Record<string, unknown>,
  Proxify extends boolean = true,
> = Proxify extends true
  ? ProxifiedRemoteFunctions<RemoteFunctions> &
      BirpcReturnBuiltin<RemoteFunctions, LocalFunctions>
  : BirpcReturnBuiltin<RemoteFunctions, LocalFunctions>;

export interface CallRawOptions {
  method: string;
  args: unknown[];
  event?: boolean;
  optional?: boolean;
}

export type PendingCallHandler = (
  options: Pick<PromiseEntry, "method" | "reject">,
) => void | Promise<void>;

interface PromiseEntry {
  resolve: (arg: any) => void;
  reject: (error: any) => void;
  method: string;
  ackTimeoutId?: ReturnType<typeof setTimeout>;
  responseTimeoutId?: ReturnType<typeof setTimeout>;
  ackReceived?: boolean;
}

interface StreamEntry {
  push: (value: any) => void;
  end: () => void;
  error: (e: any) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT = 60_000; // 1 minute

const defaultSerialize = (i: any) => i;
const defaultDeserialize = defaultSerialize;

// Store public APIs locally in case they are overridden later
const { clearTimeout, setTimeout } = globalThis;

/**
 * Create a callable proxy that supports nested property access for layered RPC calls.
 * e.g., rpc.user.getToken() will call "user.getToken" on the remote
 */
const createMethodProxy = (
  path: string,
  _call: (method: string, args: unknown[], event?: boolean) => any,
  _callStream: (method: string, args: unknown[]) => any,
  eventNames: string[],
): any => {
  const sendEvent = (...args: any[]) => _call(path, args, true);
  const sendStream = (...args: any[]) => _callStream(path, args);
  const sendCall = (...args: any[]) => _call(path, args, false);

  // Determine if this path is configured as an event
  const isEvent = eventNames.includes(path as any);
  const fn = isEvent ? sendEvent : sendCall;

  // Return a proxy that:
  // - Can be called as a function (fn(...args))
  // - Supports nested property access (fn.subMethod)
  return new Proxy(fn, {
    get(_, prop: string) {
      if (prop === "asEvent") return sendEvent;
      if (prop === "asStream") return sendStream;
      // Handle Promise-like behavior (e.g., await rpc.user)
      if (prop === "then") return undefined;
      // For nested access, build new path: "user" + "getToken" = "user.getToken"
      return createMethodProxy(
        `${path}.${prop}`,
        _call,
        _callStream,
        eventNames,
      );
    },
  });
}

/**
 * Resolve a function by traversing a dotted path in a nested object.
 * e.g., resolveNestedFunction({ user: { getToken: fn } }, "user.getToken") => fn
 */
const resolveNestedFunction = (
  functions: object,
  path: string,
): ((...args: any[]) => any) | undefined => {
  const parts = path.split(".");
  let current: any = functions;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return typeof current === "function" ? current : undefined;
}

export function createBirpc<
  RemoteFunctions extends object = Record<string, unknown>,
  LocalFunctions extends object = Record<string, unknown>,
  Proxify extends boolean = true,
>(
  $functions: LocalFunctions,
  options: BirpcOptions<RemoteFunctions, LocalFunctions, Proxify>,
): BirpcReturn<RemoteFunctions, LocalFunctions, Proxify> {
  const {
    post,
    on,
    off = () => {},
    eventNames = [],
    serialize = defaultSerialize,
    deserialize = defaultDeserialize,
    resolver,
    bind = "rpc",
    timeout = DEFAULT_TIMEOUT,
    ackTimeout,
    proxify = true,
  } = options;

  let $closed = false;

  const _rpcPromiseMap = new Map<string, PromiseEntry>();
  const _streamMap = new Map<string, StreamEntry>();
  let _promiseInit: Promise<any> | any;
  let rpc: BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>;

  function startResponseTimeout(
    id: string,
    method: string,
    args: unknown[],
    reject: (error: any) => void,
  ) {
    if (timeout < 0) return undefined;

    let responseTimeoutId: ReturnType<typeof setTimeout> | undefined =
      setTimeout(() => {
        try {
          const handleResult = options.onTimeoutError?.call(rpc, method, args);
          if (handleResult !== true)
            throw new Error(`[birpc] timeout on calling "${method}"`);
        } catch (e) {
          reject(e);
        }
        _rpcPromiseMap.delete(id);
        _streamMap.delete(id);
      }, timeout);

    // For node.js, `unref` is not available in browser-like environments
    if (typeof responseTimeoutId === "object")
      responseTimeoutId = responseTimeoutId.unref?.();

    return responseTimeoutId;
  }

  async function _call(
    method: string,
    args: unknown[],
    event?: boolean,
    optional?: boolean,
  ) {
    if ($closed)
      throw new Error(`[birpc] rpc is closed, cannot call "${method}"`);

    const req: RpcRequest = { m: method, a: args, t: TYPE_REQUEST };
    if (optional) req.o = true;

    const send = async (_req: RpcRequest) => post(serialize(_req));
    if (event) {
      await send(req);
      return;
    }

    if (_promiseInit) {
      // Wait if `on` is promise
      try {
        await _promiseInit;
      } finally {
        // don't keep resolved promise hanging
        _promiseInit = undefined;
      }
    }

    // eslint-disable-next-line prefer-const
    let { promise, resolve, reject } = createPromiseWithResolvers<any>();

    const id = nanoid();
    req.i = id;
    let ackTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let responseTimeoutId: ReturnType<typeof setTimeout> | undefined;

    async function handler(newReq: RpcRequest = req) {
      const entry: PromiseEntry = {
        resolve,
        reject,
        method,
        ackReceived: !ackTimeout, // If no ack required, mark as already received
      };

      // If ackTimeout is set, start ack timer; response timer starts after ack
      if (ackTimeout !== undefined && ackTimeout >= 0) {
        ackTimeoutId = setTimeout(() => {
          try {
            const handleResult = options.onAckTimeoutError?.call(
              rpc,
              method,
              args,
            );
            if (handleResult !== true)
              throw new Error(
                `[birpc] ack timeout on calling "${method}" - message may not have been received`,
              );
          } catch (e) {
            reject(e);
          }
          _rpcPromiseMap.delete(id);
        }, ackTimeout);

        if (typeof ackTimeoutId === "object")
          ackTimeoutId = ackTimeoutId.unref?.();

        entry.ackTimeoutId = ackTimeoutId;
      } else {
        // No ack required, start response timeout immediately
        responseTimeoutId = startResponseTimeout(id, method, args, reject);
        entry.responseTimeoutId = responseTimeoutId;
      }

      _rpcPromiseMap.set(id, entry);
      await send(newReq);
      return promise;
    }

    try {
      if (options.onRequest)
        await options.onRequest.call(rpc, req, handler, resolve);
      else await handler();
    } catch (e) {
      if (options.onGeneralError?.call(rpc, e as Error) !== true) throw e;
      return;
    } finally {
      clearTimeout(ackTimeoutId);
      clearTimeout(responseTimeoutId);
      _rpcPromiseMap.delete(id);
    }

    return promise;
  }

  function _callStream<T = unknown>(
    method: string,
    args: unknown[],
  ): AsyncIterable<T> {
    const queue: T[] = [];
    let done = false;
    let error: any;
    let resolver: (() => void) | null = null;
    let started = false;
    let startError: Error | null = null;

    const id = nanoid();

    const streamEntry: StreamEntry = {
      push: (value: T) => {
        queue.push(value);
        resolver?.();
      },
      end: () => {
        done = true;
        resolver?.();
      },
      error: (e: any) => {
        error = e;
        resolver?.();
      },
    };

    // Start the call lazily when iteration begins
    async function startCall() {
      if (started) return;
      started = true;

      if ($closed) {
        startError = new Error(
          `[birpc] rpc is closed, cannot call "${method}"`,
        );
        return;
      }

      const req: RpcRequest = { m: method, a: args, t: TYPE_REQUEST, i: id };

      try {
        // Wait for init promise if needed
        if (_promiseInit) {
          try {
            await _promiseInit;
          } finally {
            _promiseInit = undefined;
          }
        }

        // Set up ack handling if needed
        if (ackTimeout !== undefined && ackTimeout >= 0) {
          let ackTimeoutId: ReturnType<typeof setTimeout> | undefined =
            setTimeout(() => {
              try {
                const handleResult = options.onAckTimeoutError?.call(
                  rpc,
                  method,
                  args,
                );
                if (handleResult !== true) {
                  streamEntry.error(
                    new Error(
                      `[birpc] ack timeout on calling "${method}" - message may not have been received`,
                    ),
                  );
                }
              } catch (e) {
                streamEntry.error(e);
              }
              _rpcPromiseMap.delete(id);
            }, ackTimeout);

          if (typeof ackTimeoutId === "object")
            ackTimeoutId = ackTimeoutId.unref?.();

          _rpcPromiseMap.set(id, {
            resolve: () => {},
            reject: streamEntry.error,
            method,
            ackTimeoutId,
            ackReceived: false,
          });
        } else {
          // No ack required, set up response timeout for stream
          if (timeout >= 0) {
            let streamTimeoutId: ReturnType<typeof setTimeout> | undefined =
              setTimeout(() => {
                try {
                  const handleResult = options.onTimeoutError?.call(
                    rpc,
                    method,
                    args,
                  );
                  if (handleResult !== true) {
                    streamEntry.error(
                      new Error(`[birpc] timeout on calling "${method}"`),
                    );
                  }
                } catch (e) {
                  streamEntry.error(e);
                }
                _streamMap.delete(id);
              }, timeout);

            if (typeof streamTimeoutId === "object")
              streamTimeoutId = streamTimeoutId.unref?.();

            streamEntry.timeoutId = streamTimeoutId;
          }
        }

        _streamMap.set(id, streamEntry);
        await post(serialize(req));
      } catch (e) {
        startError = e as Error;
        _streamMap.delete(id);
        _rpcPromiseMap.delete(id);
      }
    }

    return {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          async next(): Promise<IteratorResult<T>> {
            // Start the call on first iteration
            await startCall();

            if (startError) {
              throw startError;
            }

            // Wait for data
            while (queue.length === 0 && !done && !error) {
              await new Promise<void>((r) => {
                resolver = r;
              });
              resolver = null;
            }

            if (error) {
              _streamMap.delete(id);
              _rpcPromiseMap.delete(id);
              throw error;
            }

            if (done && queue.length === 0) {
              _streamMap.delete(id);
              _rpcPromiseMap.delete(id);
              return { done: true, value: undefined };
            }

            return { done: false, value: queue.shift()! };
          },
          async return(): Promise<IteratorResult<T>> {
            // Cleanup on early termination
            _streamMap.delete(id);
            _rpcPromiseMap.delete(id);
            done = true;
            return { done: true, value: undefined };
          },
        };
      },
    };
  }

  const builtinMethods = {
    $call: (method: string, ...args: unknown[]) => _call(method, args, false),
    $callOptional: (method: string, ...args: unknown[]) =>
      _call(method, args, false, true),
    $callEvent: (method: string, ...args: unknown[]) =>
      _call(method, args, true),
    $callRaw: (options: CallRawOptions) =>
      _call(options.method, options.args, options.event, options.optional),
    $callStream: (method: string, ...args: unknown[]) =>
      _callStream(method, args),
    $rejectPendingCalls,
    get $closed() {
      return $closed;
    },
    get $meta() {
      return options.meta;
    },
    $close,
    $functions,
  } as BirpcReturnBuiltin<RemoteFunctions, LocalFunctions>;

  if (proxify) {
    rpc = new Proxy(
      {},
      {
        get(_, method: string) {
          if (Object.prototype.hasOwnProperty.call(builtinMethods, method))
            return (builtinMethods as any)[method];

          // catch if "createBirpc" is returned from async function
          if (
            method === "then" &&
            !eventNames.includes("then" as any) &&
            !("then" in $functions)
          )
            return undefined;

          // Return a recursive proxy that supports layered calls like rpc.user.getToken()
          return createMethodProxy(
            method,
            _call,
            _callStream,
            eventNames as string[],
          );
        },
      },
    ) as BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>;
  } else {
    rpc = builtinMethods as BirpcReturn<
      RemoteFunctions,
      LocalFunctions,
      Proxify
    >;
  }

  function $close(customError?: Error) {
    $closed = true;
    _rpcPromiseMap.forEach(
      ({ reject, method, ackTimeoutId, responseTimeoutId }) => {
        clearTimeout(ackTimeoutId);
        clearTimeout(responseTimeoutId);
        const error = new Error(
          `[birpc] rpc is closed, cannot call "${method}"`,
        );

        if (customError) {
          customError.cause ??= error;
          return reject(customError);
        }

        reject(error);
      },
    );
    _rpcPromiseMap.clear();

    // Clean up streams
    _streamMap.forEach((stream) => {
      clearTimeout(stream.timeoutId);
      stream.error(
        customError || new Error("[birpc] rpc is closed, stream terminated"),
      );
    });
    _streamMap.clear();

    off(onMessage);
  }

  function $rejectPendingCalls(handler?: PendingCallHandler) {
    const entries = Array.from(_rpcPromiseMap.values());

    const handlerResults = entries.map(({ method, reject }) => {
      if (!handler) {
        return reject(new Error(`[birpc]: rejected pending call "${method}".`));
      }

      return handler({ method, reject });
    });

    _rpcPromiseMap.clear();

    return handlerResults;
  }

  async function onMessage(data: any, ...extra: any[]) {
    let msg: RpcMessage;

    try {
      msg = deserialize(data) as RpcMessage;
    } catch (e) {
      if (options.onGeneralError?.call(rpc, e as Error) !== true) throw e;
      return;
    }

    if (msg.t === TYPE_REQUEST) {
      const { m: method, a: args, o: optional, i: requestId } = msg;

      // Send ACK immediately if request has an ID (caller may be waiting for ack)
      if (requestId) {
        try {
          await post(
            serialize(<RpcAck>{ t: TYPE_ACK, i: requestId }),
            ...extra,
          );
        } catch (e) {
          if (
            options.onGeneralError?.call(rpc, e as Error, method, args) !== true
          )
            throw e;
        }
      }

      let result, error: any;
      // Resolve nested function by path (e.g., "user.getToken" => $functions.user.getToken)
      const resolvedFn = resolveNestedFunction($functions as object, method);
      let fn = await (resolver
        ? resolver.call(rpc, method, resolvedFn as any)
        : resolvedFn);

      if (optional) fn ||= () => undefined;

      if (!fn) {
        error = new Error(`[birpc] function "${method}" not found`);
      } else {
        try {
          result = await fn.apply(bind === "rpc" ? rpc : $functions, args);
        } catch (e) {
          error = e;
        }
      }

      if (requestId) {
        if (error && options.onFunctionError) {
          if (options.onFunctionError.call(rpc, error, method, args) === true)
            return;
        }

        // Check if result is an async iterator for streaming
        if (!error && isAsyncIterable(result)) {
          try {
            for await (const value of result) {
              await post(
                serialize(<RpcStreamNext>{
                  t: TYPE_STREAM_NEXT,
                  i: requestId,
                  v: value,
                }),
                ...extra,
              );
            }
            await post(
              serialize(<RpcStreamEnd>{ t: TYPE_STREAM_END, i: requestId }),
              ...extra,
            );
            return;
          } catch (e) {
            // Send stream error
            try {
              await post(
                serialize(<RpcStreamError>{
                  t: TYPE_STREAM_ERROR,
                  i: requestId,
                  e,
                }),
                ...extra,
              );
            } catch (sendError) {
              if (
                options.onGeneralError?.call(
                  rpc,
                  sendError as Error,
                  method,
                  args,
                ) !== true
              )
                throw sendError;
            }
            return;
          }
        }

        // Send regular response
        if (!error) {
          try {
            await post(
              serialize(<RpcResponse>{
                t: TYPE_RESPONSE,
                i: requestId,
                r: result,
              }),
              ...extra,
            );
            return;
          } catch (e) {
            error = e;
            if (
              options.onGeneralError?.call(rpc, e as Error, method, args) !==
              true
            )
              throw e;
          }
        }
        // Try to send error if serialization failed
        try {
          await post(
            serialize(<RpcResponse>{
              t: TYPE_RESPONSE,
              i: requestId,
              e: error,
            }),
            ...extra,
          );
        } catch (e) {
          if (
            options.onGeneralError?.call(rpc, e as Error, method, args) !== true
          )
            throw e;
        }
      }
    } else if (msg.t === TYPE_ACK) {
      // Handle ACK message
      const { i: ackId } = msg;
      const entry = _rpcPromiseMap.get(ackId);
      if (entry && !entry.ackReceived) {
        clearTimeout(entry.ackTimeoutId);
        entry.ackReceived = true;
        // Now start response timeout
        entry.responseTimeoutId = startResponseTimeout(
          ackId,
          entry.method,
          [], // args not available here, using empty array
          entry.reject,
        );
      }
    } else if (msg.t === TYPE_STREAM_NEXT) {
      // Handle stream next value
      const { i: streamId, v: value } = msg;
      const stream = _streamMap.get(streamId);
      if (stream) {
        stream.push(value);
      }
    } else if (msg.t === TYPE_STREAM_END) {
      // Handle stream end
      const { i: streamId } = msg;
      const stream = _streamMap.get(streamId);
      const entry = _rpcPromiseMap.get(streamId);
      if (stream) {
        clearTimeout(stream.timeoutId);
        stream.end();
        _streamMap.delete(streamId);
      }
      if (entry) {
        clearTimeout(entry.responseTimeoutId);
        _rpcPromiseMap.delete(streamId);
      }
    } else if (msg.t === TYPE_STREAM_ERROR) {
      // Handle stream error
      const { i: streamId, e: error } = msg;
      const stream = _streamMap.get(streamId);
      const entry = _rpcPromiseMap.get(streamId);
      if (stream) {
        clearTimeout(stream.timeoutId);
        stream.error(error);
        _streamMap.delete(streamId);
      }
      if (entry) {
        clearTimeout(entry.responseTimeoutId);
        _rpcPromiseMap.delete(streamId);
      }
    } else if (msg.t === TYPE_RESPONSE) {
      // Handle regular response
      const { i: ack, r: result, e: error } = msg;
      const promise = _rpcPromiseMap.get(ack);
      if (promise) {
        clearTimeout(promise.ackTimeoutId);
        clearTimeout(promise.responseTimeoutId);

        if (error) promise.reject(error);
        else promise.resolve(result);
      }
      _rpcPromiseMap.delete(ack);
    }
  }

  _promiseInit = on(onMessage);

  return rpc;
}
