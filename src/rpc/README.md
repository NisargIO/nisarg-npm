# birpc

Message-based two-way remote procedure call. Useful for WebSockets, Workers, and any message-based communication.

## Features

- **Intuitive** - Call remote functions just like local ones, with Promises for responses
- **TypeScript** - Full type safety for function arguments and return values
- **Protocol Agnostic** - Works with WebSocket, MessageChannel, or any message-based protocol
- **Namespaced APIs** - Organize functions into nested namespaces like `rpc.user.getToken()`
- **Acknowledge Events** - Confirm message delivery with independent ack timeouts
- **Streaming Support** - Stream data using async iterators
- **Error Handling** - Comprehensive error handling with custom handlers
- **Zero Dependencies** - Lightweight and minimal

## Table of Contents

- [Installation](#installation)
- [Basic Usage](#basic-usage)
- [API Reference](#api-reference)
- [Features](#features-1)
  - [Remote Function Calls](#remote-function-calls)
  - [Namespaced APIs (Layered Calls)](#namespaced-apis-layered-calls)
  - [Events (Fire-and-Forget)](#events-fire-and-forget)
  - [Acknowledge Events](#acknowledge-events)
  - [Async Iterator Streaming](#async-iterator-streaming)
  - [Timeouts](#timeouts)
  - [Error Handling](#error-handling)
  - [Groups (One-to-Many)](#groups-one-to-many)
- [Protocol Examples](#protocol-examples)
- [Advanced Usage](#advanced-usage)

## Installation

```bash
npm install birpc
# or
bun add birpc
```

## Basic Usage

### Using WebSocket

```ts
// types.ts
export interface ServerFunctions {
  hi(name: string): string;
}

export interface ClientFunctions {
  hey(name: string): string;
}
```

#### Client

```ts
import type { ServerFunctions, ClientFunctions } from './types'
import { createBirpc } from 'birpc'

const ws = new WebSocket('ws://localhost:3000')

const clientFunctions: ClientFunctions = {
  hey(name: string) {
    return `Hey ${name} from client`
  }
}

const rpc = createBirpc<ServerFunctions, ClientFunctions>(
  clientFunctions,
  {
    post: data => ws.send(data),
    on: fn => ws.addEventListener('message', e => fn(e.data)),
    serialize: JSON.stringify,
    deserialize: JSON.parse,
  },
)

// Call remote function
const response = await rpc.hi('Client')
console.log(response) // "Hi Client from server"
```

#### Server

```ts
import type { ServerFunctions, ClientFunctions } from './types'
import { createBirpc } from 'birpc'
import { WebSocketServer } from 'ws'

const serverFunctions: ServerFunctions = {
  hi(name: string) {
    return `Hi ${name} from server`
  }
}

const wss = new WebSocketServer({ port: 3000 })

wss.on('connection', (ws) => {
  const rpc = createBirpc<ClientFunctions, ServerFunctions>(
    serverFunctions,
    {
      post: data => ws.send(data),
      on: fn => ws.on('message', fn),
      serialize: JSON.stringify,
      deserialize: JSON.parse,
    },
  )

  // Call client function
  const response = await rpc.hey('Server')
  console.log(response) // "Hey Server from client"
})
```

### Using MessageChannel

MessageChannel automatically serializes messages and supports circular references.

```ts
import { createBirpc } from 'birpc'
import { MessageChannel } from 'node:worker_threads'

const channel = new MessageChannel()

// Alice
const alice = createBirpc<BobFunctions, AliceFunctions>(
  { hi: (name) => `Hi ${name}, I am Alice` },
  {
    post: data => channel.port1.postMessage(data),
    on: fn => channel.port1.on('message', fn),
  },
)

// Bob
const bob = createBirpc<AliceFunctions, BobFunctions>(
  { hey: (name) => `Hey ${name}, I am Bob` },
  {
    post: data => channel.port2.postMessage(data),
    on: fn => channel.port2.on('message', fn),
  },
)

await alice.hey('Alice') // "Hey Alice, I am Bob"
await bob.hi('Bob')      // "Hi Bob, I am Alice"
```

## API Reference

### `createBirpc<RemoteFunctions, LocalFunctions>(functions, options)`

Creates a new RPC instance.

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `functions` | `LocalFunctions` | Object containing local functions that can be called remotely |
| `options` | `BirpcOptions` | Configuration options |

#### Options

##### Channel Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `post` | `(data: any) => void` | Required | Function to send messages |
| `on` | `(fn: Function) => void` | Required | Function to register message listener |
| `off` | `(fn: Function) => void` | `undefined` | Function to unregister listener on close |
| `serialize` | `(data: any) => any` | Identity | Custom serialization function |
| `deserialize` | `(data: any) => any` | Identity | Custom deserialization function |
| `bind` | `'rpc' \| 'functions'` | `'rpc'` | Context for `this` in local functions |
| `meta` | `any` | `undefined` | Custom metadata accessible via `$meta` |

##### Event Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `eventNames` | `string[]` | `[]` | Function names that don't expect responses |
| `timeout` | `number` | `60000` | Response timeout in milliseconds |
| `ackTimeout` | `number` | `undefined` | Acknowledgment timeout in milliseconds |
| `proxify` | `boolean` | `true` | Whether to create proxy for remote calls |
| `resolver` | `Function` | `undefined` | Custom function resolver |

##### Error Handlers

| Option | Type | Description |
|--------|------|-------------|
| `onFunctionError` | `(error, name, args) => boolean \| void` | Handle errors in local functions |
| `onGeneralError` | `(error, name?, args?) => boolean \| void` | Handle serialization/messaging errors |
| `onTimeoutError` | `(name, args) => boolean \| void` | Handle response timeouts |
| `onAckTimeoutError` | `(name, args) => boolean \| void` | Handle acknowledgment timeouts |

#### Return Value

Returns an RPC instance with:

##### Built-in Methods

| Method | Description |
|--------|-------------|
| `$call(method, ...args)` | Call remote function explicitly |
| `$callOptional(method, ...args)` | Call remote function, returns `undefined` if not found |
| `$callEvent(method, ...args)` | Send event without waiting for response |
| `$callStream(method, ...args)` | Call and return async iterable for streaming |
| `$close(error?)` | Close the RPC connection |
| `$rejectPendingCalls(handler?)` | Reject all pending calls |

##### Built-in Properties

| Property | Description |
|----------|-------------|
| `$functions` | The local functions object |
| `$closed` | Whether the RPC is closed |
| `$meta` | Custom metadata from options |

##### Proxied Methods (when `proxify: true`)

Each remote function is available as a method with additional helpers:

```ts
rpc.methodName(...args)           // Call and wait for response
rpc.methodName.asEvent(...args)   // Fire-and-forget
rpc.methodName.asStream(...args)  // Stream results as async iterable
```

---

## Features

### Remote Function Calls

Call remote functions as if they were local. All calls return Promises.

```ts
// Define types
interface RemoteFunctions {
  add(a: number, b: number): number;
  greet(name: string): string;
}

// Call remote functions
const sum = await rpc.add(5, 3)        // 8
const greeting = await rpc.greet('World') // "Hello World"

// Or use $call explicitly
const result = await rpc.$call('add', 5, 3)
```

### Namespaced APIs (Layered Calls)

Organize your API into nested namespaces for better structure. Call remote functions using dot notation like `rpc.user.getToken()`.

#### Defining Nested Types

```ts
// Define nested function types
interface ServerFunctions {
  user: {
    getToken(): string;
    getProfile(id: number): { id: number; name: string };
    settings: {
      get(key: string): string;
      set(key: string, value: string): void;
    };
  };
  auth: {
    login(username: string, password: string): boolean;
    logout(): void;
  };
}
```

#### Server-Side Implementation

Define local functions as nested objects matching your type structure:

```ts
const serverFunctions = {
  user: {
    getToken() {
      return 'token-123';
    },
    getProfile(id: number) {
      return { id, name: `User ${id}` };
    },
    settings: {
      get(key: string) {
        return localStorage.getItem(key) ?? '';
      },
      set(key: string, value: string) {
        localStorage.setItem(key, value);
      },
    },
  },
  auth: {
    login(username: string, password: string) {
      return username === 'admin' && password === 'secret';
    },
    logout() {
      // Clear session
    },
  },
};

const rpc = createBirpc<ClientFunctions, typeof serverFunctions>(
  serverFunctions,
  options,
);
```

#### Client-Side Usage

Call nested functions naturally:

```ts
const rpc = createBirpc<ServerFunctions, ClientFunctions>(
  clientFunctions,
  options,
);

// Single-level namespace
const token = await rpc.user.getToken();
const profile = await rpc.user.getProfile(42);

// Deeply nested namespace
const theme = await rpc.user.settings.get('theme');
await rpc.user.settings.set('theme', 'dark');

// Different namespace
const success = await rpc.auth.login('admin', 'secret');
await rpc.auth.logout();
```

#### Using with $call

You can also use `$call` with dot-notation strings:

```ts
// These are equivalent
await rpc.user.getToken();
await rpc.$call('user.getToken');

// With arguments
await rpc.user.settings.get('theme');
await rpc.$call('user.settings.get', 'theme');
```

#### Events and Streams with Namespaces

All method modifiers work with namespaced calls:

```ts
// Fire-and-forget event
await rpc.auth.logout.asEvent();

// Streaming (if the function returns an async iterator)
for await (const item of rpc.data.stream.asStream()) {
  console.log(item);
}
```

#### Groups with Namespaced Calls

Namespaced calls also work with `createBirpcGroup` for broadcasting:

```ts
const group = createBirpcGroup<ClientFunctions, ServerFunctions>(
  serverFunctions,
  channels,
);

// Broadcast to all clients using namespaced path
const results = await group.broadcast.client.notify('Hello everyone');

// Or using $call with dot notation
const results = await group.broadcast.$call('client.notify', 'Hello everyone');
```

### Events (Fire-and-Forget)

Send messages without waiting for a response.

```ts
// Method 1: Configure event names
const rpc = createBirpc<RemoteFunctions>(functions, {
  // ...options
  eventNames: ['log', 'notify'],
})

await rpc.log('Something happened') // Returns immediately

// Method 2: Use asEvent on any method
await rpc.someMethod.asEvent(arg1, arg2)

// Method 3: Use $callEvent
await rpc.$callEvent('methodName', arg1, arg2)
```

### Acknowledge Events

Confirm that messages are received before processing completes. Useful for unreliable connections.

```ts
const rpc = createBirpc<RemoteFunctions>(functions, {
  // ...options
  ackTimeout: 5000,  // 5 second ack timeout
  timeout: 60000,    // 60 second response timeout
})

try {
  // 1. Request sent to receiver
  // 2. Receiver sends ACK immediately upon receipt
  // 3. Caller receives ACK (ackTimeout cleared)
  // 4. Response timeout starts
  // 5. Receiver processes and sends response
  // 6. Caller receives response
  const result = await rpc.slowOperation()
} catch (e) {
  // If no ACK received within ackTimeout:
  // Error: "[birpc] ack timeout on calling "slowOperation" - message may not have been received"
}
```

#### Ack Flow Diagram

```
Caller                           Receiver
  |                                  |
  |-- Request (id=123) ------------->|
  |   [Start ackTimeout]             |
  |                                  |-- ACK (id=123)
  |<---------------------------------|
  |   [Clear ackTimeout]             |
  |   [Start responseTimeout]        |
  |                                  |   [Processing...]
  |                                  |
  |<-- Response (id=123) ------------|
  |   [Clear responseTimeout]        |
  |   [Resolve promise]              |
```

#### Custom Ack Error Handler

```ts
const rpc = createBirpc<RemoteFunctions>(functions, {
  ackTimeout: 5000,
  onAckTimeoutError(functionName, args) {
    console.error(`No ACK for ${functionName}`)
    // Return true to suppress the error
    // Throw custom error to override default
    throw new Error('Connection may be lost')
  },
})
```

### Async Iterator Streaming

Stream data from remote functions using async iterators.

#### Server Side

Return an async generator from your function:

```ts
const functions = {
  async *streamNumbers(count: number) {
    for (let i = 0; i < count; i++) {
      await delay(100)
      yield i
    }
  },

  async *streamEvents() {
    while (true) {
      const event = await waitForEvent()
      yield event
      if (event.type === 'end') break
    }
  },
}
```

#### Client Side

Consume the stream with `for await...of`:

```ts
// Method 1: Using $callStream
for await (const num of rpc.$callStream('streamNumbers', 10)) {
  console.log(num) // 0, 1, 2, ... 9
}

// Method 2: Using asStream
for await (const num of rpc.streamNumbers.asStream(10)) {
  console.log(num)
}

// Early termination
for await (const event of rpc.streamEvents.asStream()) {
  console.log(event)
  if (shouldStop) break // Stream cleanup handled automatically
}
```

#### Stream Flow Diagram

```
Caller                           Receiver
  |                                  |
  |-- Request (method=stream) ------>|
  |                                  |
  |<-- StreamNext (value=1) ---------|
  |<-- StreamNext (value=2) ---------|
  |<-- StreamNext (value=3) ---------|
  |<-- StreamEnd --------------------|
  |   [Iterator completes]           |
```

#### Stream Error Handling

```ts
try {
  for await (const item of rpc.riskyStream.asStream()) {
    process(item)
  }
} catch (e) {
  // Errors thrown in the remote generator are propagated here
  console.error('Stream error:', e)
}
```

### Timeouts

Configure timeouts for responses and acknowledgments.

```ts
const rpc = createBirpc<RemoteFunctions>(functions, {
  timeout: 30000,     // 30s response timeout (default: 60s)
  ackTimeout: 5000,   // 5s ack timeout (default: undefined/disabled)

  onTimeoutError(functionName, args) {
    console.error(`Timeout calling ${functionName}`)
    // Return true to suppress error
    // Throw to provide custom error
  },
})

// Disable timeout for a specific call
const rpc = createBirpc<RemoteFunctions>(functions, {
  timeout: -1, // Disables timeout
})
```

### Error Handling

Comprehensive error handling for different scenarios.

```ts
const rpc = createBirpc<RemoteFunctions>(functions, {
  // Handle errors in local functions being called remotely
  onFunctionError(error, functionName, args) {
    logger.error(`Error in ${functionName}:`, error)
    // Return true to prevent error from being sent to caller
    return false
  },

  // Handle serialization/deserialization errors
  onGeneralError(error, functionName, args) {
    logger.error('RPC error:', error)
    return false
  },

  // Handle response timeouts
  onTimeoutError(functionName, args) {
    logger.warn(`Timeout: ${functionName}`)
    return false
  },

  // Handle ack timeouts
  onAckTimeoutError(functionName, args) {
    logger.warn(`No ACK: ${functionName}`)
    return false
  },
})
```

### Groups (One-to-Many)

Broadcast to multiple clients using `createBirpcGroup`.

```ts
import { createBirpcGroup } from 'birpc'

const group = createBirpcGroup<ClientFunctions, ServerFunctions>(
  serverFunctions,
  () => clients.map(ws => ({
    post: data => ws.send(data),
    on: fn => ws.on('message', fn),
  })),
)

// Broadcast to all clients
const results = await group.broadcast.notify('Hello everyone')

// Access individual clients
group.clients.forEach(client => {
  client.sendMessage('Individual message')
})

// Update channels dynamically
group.updateChannels((channels) => {
  // Modify channels array
})
```

---

## Protocol Examples

### WebSocket with JSON

```ts
const rpc = createBirpc<RemoteFunctions>(functions, {
  post: data => ws.send(data),
  on: fn => ws.addEventListener('message', e => fn(e.data)),
  serialize: JSON.stringify,
  deserialize: JSON.parse,
})
```

### WebSocket with Circular Reference Support

Using [structured-clone-es](https://github.com/nicolo-ribaudo/structured-clone-es):

```ts
import { stringify, parse } from 'structured-clone-es'

const rpc = createBirpc<RemoteFunctions>(functions, {
  post: data => ws.send(data),
  on: fn => ws.addEventListener('message', e => fn(e.data)),
  serialize: stringify,
  deserialize: parse,
})
```

### Web Workers

```ts
// main.ts
const worker = new Worker('./worker.ts')

const rpc = createBirpc<WorkerFunctions>(mainFunctions, {
  post: data => worker.postMessage(data),
  on: fn => worker.addEventListener('message', e => fn(e.data)),
})

// worker.ts
const rpc = createBirpc<MainFunctions>(workerFunctions, {
  post: data => self.postMessage(data),
  on: fn => self.addEventListener('message', e => fn(e.data)),
})
```

### Electron IPC

```ts
// Main process
const rpc = createBirpc<RendererFunctions>(mainFunctions, {
  post: data => win.webContents.send('rpc', data),
  on: fn => ipcMain.on('rpc', (_, data) => fn(data)),
})

// Renderer process
const rpc = createBirpc<MainFunctions>(rendererFunctions, {
  post: data => ipcRenderer.send('rpc', data),
  on: fn => ipcRenderer.on('rpc', (_, data) => fn(data)),
})
```

---

## Advanced Usage

### Custom Function Resolver

Dynamically resolve functions at runtime:

```ts
const rpc = createBirpc<RemoteFunctions>(functions, {
  resolver(name, defaultFn) {
    // Return custom function or modify behavior
    if (name.startsWith('admin_')) {
      return this.$meta.isAdmin ? defaultFn : undefined
    }
    return defaultFn
  },
})
```

### Request Hooks

Intercept and modify requests:

```ts
const rpc = createBirpc<RemoteFunctions>(functions, {
  onRequest(req, next, resolve) {
    // Modify request
    req.a.push(this.$meta.userId)

    // Or resolve directly without sending
    if (isCached(req)) {
      return resolve(getCached(req))
    }

    // Continue with (optionally modified) request
    return next(req)
  },
})
```

### Accessing RPC Context in Functions

When `bind: 'rpc'` (default), local functions have access to the RPC instance:

```ts
const functions = {
  async getStatus() {
    // `this` is the RPC instance
    const clientInfo = await this.getClientInfo()
    return { server: 'ok', client: clientInfo }
  },
}
```

### Closing Connections

```ts
// Clean close
rpc.$close()

// Close with error (propagated to pending calls)
rpc.$close(new Error('Connection lost'))

// Reject pending calls with custom handler
rpc.$rejectPendingCalls(({ method, reject }) => {
  reject(new Error(`Call to ${method} was cancelled`))
})
```

### Without Proxy (Manual Calls)

For environments where Proxy is not available:

```ts
const rpc = createBirpc<RemoteFunctions, LocalFunctions, false>(functions, {
  proxify: false,
  // ...options
})

// Must use $call methods explicitly
const result = await rpc.$call('methodName', arg1, arg2)
const stream = rpc.$callStream('streamMethod', arg)
```

---

## Message Protocol

The RPC uses a simple message protocol:

### Request
```ts
{ t: 'q', i?: string, m: string, a: any[], o?: boolean }
// t: type ('q' = request)
// i: id (for calls expecting response)
// m: method name (can be dot-separated for namespaced calls, e.g., "user.getToken")
// a: arguments array
// o: optional flag
```

### Response
```ts
{ t: 's', i: string, r?: any, e?: any }
// t: type ('s' = response)
// i: id
// r: result
// e: error
```

### Acknowledge
```ts
{ t: 'a', i: string }
// t: type ('a' = ack)
// i: request id being acknowledged
```

### Stream Messages
```ts
{ t: 'n', i: string, v: any }  // next value
{ t: 'd', i: string }          // done/end
{ t: 'x', i: string, e: any }  // error
```

---

## License

MIT
