import { MessageChannel } from "node:worker_threads";
import { expect, it } from "vitest";
import { createBirpc } from "../src/main";

interface StreamFunctions {
  numbers: (count: number) => AsyncIterable<number>;
  delayed: (count: number, delay: number) => AsyncIterable<number>;
  errorAfter: (count: number) => AsyncIterable<number>;
  empty: () => AsyncIterable<never>;
  mixed: (values: (number | string)[]) => AsyncIterable<number | string>;
}

interface EmptyFunctions {}

function createStreamChannel() {
  const channel = new MessageChannel();

  const streamFunctions: StreamFunctions = {
    async *numbers(count: number) {
      for (let i = 0; i < count; i++) {
        yield i;
      }
    },
    async *delayed(count: number, delay: number) {
      for (let i = 0; i < count; i++) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        yield i;
      }
    },
    async *errorAfter(count: number) {
      for (let i = 0; i < count; i++) {
        yield i;
      }
      throw new Error("Stream error after yielding values");
    },
    async *empty() {
      // Yields nothing
    },
    async *mixed(values: (number | string)[]) {
      for (const v of values) {
        yield v;
      }
    },
  };

  const server = createBirpc<EmptyFunctions, StreamFunctions>(streamFunctions, {
    post: (data) => channel.port1.postMessage(data),
    on: (fn) => channel.port1.on("message", fn),
  });

  const client = createBirpc<StreamFunctions, EmptyFunctions>(
    {},
    {
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
    },
  );

  return { channel, server, client };
}

it("basic async iterator streaming", async () => {
  const { client } = createStreamChannel();

  const results: number[] = [];
  for await (const value of client.$callStream("numbers", 5)) {
    results.push(value as number);
  }

  expect(results).toEqual([0, 1, 2, 3, 4]);
});

it("streaming with asStream method", async () => {
  const { client } = createStreamChannel();

  const results: number[] = [];
  for await (const value of client.numbers.asStream(5)) {
    results.push(value as number);
  }

  expect(results).toEqual([0, 1, 2, 3, 4]);
});

it("streaming with delays", async () => {
  const { client } = createStreamChannel();

  const results: number[] = [];
  const start = Date.now();

  for await (const value of client.$callStream("delayed", 3, 50)) {
    results.push(value as number);
  }

  const elapsed = Date.now() - start;

  expect(results).toEqual([0, 1, 2]);
  // Should have taken at least 100ms (3 items * 50ms - some buffer)
  expect(elapsed).toBeGreaterThanOrEqual(100);
});

it("empty stream", async () => {
  const { client } = createStreamChannel();

  const results: unknown[] = [];
  for await (const value of client.empty.asStream()) {
    results.push(value);
  }

  expect(results).toEqual([]);
});

it("stream with mixed types", async () => {
  const { client } = createStreamChannel();

  const results: (number | string)[] = [];
  for await (const value of client.$callStream("mixed", [
    1,
    "hello",
    2,
    "world",
  ])) {
    results.push(value as number | string);
  }

  expect(results).toEqual([1, "hello", 2, "world"]);
});

it("stream error propagation", async () => {
  const { client } = createStreamChannel();

  const results: number[] = [];
  try {
    for await (const value of client.$callStream("errorAfter", 3)) {
      results.push(value as number);
    }
    expect.fail("Should have thrown");
  } catch (e) {
    expect((e as Error).message).toBe("Stream error after yielding values");
  }

  // Should have received values before the error
  expect(results).toEqual([0, 1, 2]);
});

it("stream early termination with break", async () => {
  const { client } = createStreamChannel();

  const results: number[] = [];
  for await (const value of client.$callStream("numbers", 10)) {
    results.push(value as number);
    if (results.length >= 3) break;
  }

  expect(results).toEqual([0, 1, 2]);
});

it("stream timeout", async () => {
  const channel = new MessageChannel();

  const server = createBirpc<EmptyFunctions, StreamFunctions>(
    {
      async *numbers(count: number) {
        for (let i = 0; i < count; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          yield i;
        }
      },
      async *delayed() {
        yield 0;
      },
      async *errorAfter() {
        yield 0;
      },
      async *empty() {},
      async *mixed() {
        yield 0;
      },
    },
    {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
    },
  );

  const client = createBirpc<StreamFunctions, EmptyFunctions>(
    {},
    {
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
      timeout: 150, // Will timeout before all values are sent
    },
  );

  const results: number[] = [];
  try {
    for await (const value of client.$callStream("numbers", 10)) {
      results.push(value as number);
    }
    expect.fail("Should have thrown timeout error");
  } catch (e) {
    expect((e as Error).message).toContain("timeout");
  }

  // Should have received some values before timeout
  expect(results.length).toBeGreaterThan(0);
  expect(results.length).toBeLessThan(10);
});

it("multiple concurrent streams", async () => {
  const { client } = createStreamChannel();

  const stream1Results: number[] = [];
  const stream2Results: number[] = [];

  const stream1Promise = (async () => {
    for await (const value of client.$callStream("numbers", 3)) {
      stream1Results.push(value as number);
    }
  })();

  const stream2Promise = (async () => {
    for await (const value of client.$callStream("numbers", 5)) {
      stream2Results.push(value as number);
    }
  })();

  await Promise.all([stream1Promise, stream2Promise]);

  expect(stream1Results).toEqual([0, 1, 2]);
  expect(stream2Results).toEqual([0, 1, 2, 3, 4]);
});

it("stream with ack timeout", async () => {
  const channel = new MessageChannel();

  const server = createBirpc<EmptyFunctions, StreamFunctions>(
    {
      async *numbers(count: number) {
        for (let i = 0; i < count; i++) {
          yield i;
        }
      },
      async *delayed() {
        yield 0;
      },
      async *errorAfter() {
        yield 0;
      },
      async *empty() {},
      async *mixed() {
        yield 0;
      },
    },
    {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
    },
  );

  const client = createBirpc<StreamFunctions, EmptyFunctions>(
    {},
    {
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
      ackTimeout: 1000,
      timeout: 5000,
    },
  );

  const results: number[] = [];
  for await (const value of client.$callStream("numbers", 5)) {
    results.push(value as number);
  }

  expect(results).toEqual([0, 1, 2, 3, 4]);
});

it("closed rpc rejects stream", async () => {
  const { client } = createStreamChannel();

  // Close immediately
  client.$close();

  try {
    for await (const value of client.$callStream("numbers", 5)) {
      // Should not get here
    }
    expect.fail("Should have thrown");
  } catch (e) {
    expect((e as Error).message).toContain("closed");
  }
});

it("stream with complex objects", async () => {
  const channel = new MessageChannel();

  interface User {
    id: number;
    name: string;
    metadata: { created: string };
  }

  interface ObjectStreamFunctions {
    users: () => AsyncIterable<User>;
  }

  const server = createBirpc<{}, ObjectStreamFunctions>(
    {
      async *users() {
        yield { id: 1, name: "Alice", metadata: { created: "2024-01-01" } };
        yield { id: 2, name: "Bob", metadata: { created: "2024-01-02" } };
        yield { id: 3, name: "Charlie", metadata: { created: "2024-01-03" } };
      },
    },
    {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
    },
  );

  const client = createBirpc<ObjectStreamFunctions, {}>(
    {},
    {
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
    },
  );

  const users: User[] = [];
  for await (const user of client.$callStream("users")) {
    users.push(user as User);
  }

  expect(users).toEqual([
    { id: 1, name: "Alice", metadata: { created: "2024-01-01" } },
    { id: 2, name: "Bob", metadata: { created: "2024-01-02" } },
    { id: 3, name: "Charlie", metadata: { created: "2024-01-03" } },
  ]);
});

it("error at beginning of stream", async () => {
  const channel = new MessageChannel();

  interface ErrorStreamFunctions {
    failImmediately: () => AsyncIterable<number>;
  }

  const server = createBirpc<{}, ErrorStreamFunctions>(
    {
      async *failImmediately() {
        throw new Error("Immediate failure");
      },
    },
    {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
    },
  );

  const client = createBirpc<ErrorStreamFunctions, {}>(
    {},
    {
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
    },
  );

  const results: number[] = [];
  try {
    for await (const value of client.$callStream("failImmediately")) {
      results.push(value as number);
    }
    expect.fail("Should have thrown");
  } catch (e) {
    expect((e as Error).message).toBe("Immediate failure");
  }

  expect(results).toEqual([]);
});

it("large stream with many values", async () => {
  const channel = new MessageChannel();

  interface LargeStreamFunctions {
    manyNumbers: (count: number) => AsyncIterable<number>;
  }

  const server = createBirpc<{}, LargeStreamFunctions>(
    {
      async *manyNumbers(count: number) {
        for (let i = 0; i < count; i++) {
          yield i;
        }
      },
    },
    {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
    },
  );

  const client = createBirpc<LargeStreamFunctions, {}>(
    {},
    {
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
    },
  );

  const results: number[] = [];
  for await (const value of client.$callStream("manyNumbers", 1000)) {
    results.push(value as number);
  }

  expect(results.length).toBe(1000);
  expect(results[0]).toBe(0);
  expect(results[999]).toBe(999);
});

it("stream iterator return() called on break", async () => {
  const { client } = createStreamChannel();

  const stream = client.$callStream("numbers", 100);
  const iterator = stream[Symbol.asyncIterator]();

  // Get a few values
  const first = await iterator.next();
  const second = await iterator.next();

  expect(first.value).toBe(0);
  expect(second.value).toBe(1);

  // Call return to clean up early
  const returnResult = await iterator.return?.();
  expect(returnResult?.done).toBe(true);

  // Subsequent calls should also return done
  const afterReturn = await iterator.next();
  expect(afterReturn.done).toBe(true);
});

it("server close during active stream", async () => {
  const channel = new MessageChannel();

  interface SlowStreamFunctions {
    slowNumbers: () => AsyncIterable<number>;
  }

  const server = createBirpc<{}, SlowStreamFunctions>(
    {
      async *slowNumbers() {
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          yield i;
        }
      },
    },
    {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
    },
  );

  const client = createBirpc<SlowStreamFunctions, {}>(
    {},
    {
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
    },
  );

  const results: number[] = [];
  const streamPromise = (async () => {
    for await (const value of client.$callStream("slowNumbers")) {
      results.push(value as number);
    }
  })();

  // Wait for some values then close
  await new Promise((resolve) => setTimeout(resolve, 120));
  client.$close(new Error("Connection lost"));

  try {
    await streamPromise;
    expect.fail("Should have thrown");
  } catch (e) {
    expect((e as Error).message).toBe("Connection lost");
  }

  // Should have received some values before close
  expect(results.length).toBeGreaterThan(0);
});

it("stream ack timeout when no server", async () => {
  const channel = new MessageChannel();

  // Only client, no server
  const client = createBirpc<StreamFunctions, {}>(
    {},
    {
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
      ackTimeout: 100,
      timeout: 5000,
    },
  );

  try {
    for await (const value of client.$callStream("numbers", 5)) {
      // Should not get here
    }
    expect.fail("Should have thrown");
  } catch (e) {
    expect((e as Error).message).toContain("ack timeout");
  }
});

it("combining regular calls with streams", async () => {
  const channel = new MessageChannel();

  interface MixedFunctions {
    add: (a: number, b: number) => number;
    range: (start: number, end: number) => AsyncIterable<number>;
  }

  const server = createBirpc<{}, MixedFunctions>(
    {
      add: (a: number, b: number) => a + b,
      async *range(start: number, end: number) {
        for (let i = start; i < end; i++) {
          yield i;
        }
      },
    },
    {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
    },
  );

  const client = createBirpc<MixedFunctions, {}>(
    {},
    {
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
    },
  );

  // Regular call
  const sum = await client.add(5, 3);
  expect(sum).toBe(8);

  // Stream call
  const rangeResults: number[] = [];
  for await (const value of client.$callStream("range", 10, 15)) {
    rangeResults.push(value as number);
  }
  expect(rangeResults).toEqual([10, 11, 12, 13, 14]);

  // Another regular call
  const sum2 = await client.add(10, 20);
  expect(sum2).toBe(30);
});

it("stream with null and undefined values", async () => {
  const channel = new MessageChannel();

  interface NullableStreamFunctions {
    nullables: () => AsyncIterable<number | null | undefined>;
  }

  const server = createBirpc<{}, NullableStreamFunctions>(
    {
      async *nullables() {
        yield 1;
        yield null;
        yield 2;
        yield undefined;
        yield 3;
      },
    },
    {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
    },
  );

  const client = createBirpc<NullableStreamFunctions, {}>(
    {},
    {
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
    },
  );

  const results: (number | null | undefined)[] = [];
  for await (const value of client.$callStream("nullables")) {
    results.push(value as number | null | undefined);
  }

  expect(results).toEqual([1, null, 2, undefined, 3]);
});

it("reusing stream after completion", async () => {
  const { client } = createStreamChannel();

  // First iteration
  const results1: number[] = [];
  for await (const value of client.numbers.asStream(3)) {
    results1.push(value as number);
  }
  expect(results1).toEqual([0, 1, 2]);

  // Second iteration (new stream)
  const results2: number[] = [];
  for await (const value of client.numbers.asStream(5)) {
    results2.push(value as number);
  }
  expect(results2).toEqual([0, 1, 2, 3, 4]);
});
