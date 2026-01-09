import type * as Alice from "./alice";
import { MessageChannel } from "node:worker_threads";
import { expect, it, vi } from "vitest";
import { createBirpc } from "../src/main";
import * as Bob from "./bob";

type AliceFunctions = typeof Alice;
type BobFunctions = typeof Bob;

it("ack timeout rejects when no receiver", async () => {
  const channel = new MessageChannel();

  // Create bob without alice - no one to receive and ACK
  const bob = createBirpc<AliceFunctions, BobFunctions>(Bob, {
    post: (data) => channel.port1.postMessage(data),
    on: (fn) => channel.port1.on("message", fn),
    ackTimeout: 100,
    timeout: 5000,
  });

  // No alice to receive, so ack should timeout
  try {
    await bob.hello("Bob");
    expect.fail("Should have thrown ack timeout error");
  } catch (e) {
    expect((e as Error).message).toContain("ack timeout");
  }
});

it("ack timeout works correctly when receiver responds", async () => {
  const channel = new MessageChannel();

  const alice = createBirpc<BobFunctions, AliceFunctions>(
    { hello: (name: string) => `Hello ${name}, my name is Alice` },
    {
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
    },
  );

  const bob = createBirpc<AliceFunctions, BobFunctions>(Bob, {
    post: (data) => channel.port1.postMessage(data),
    on: (fn) => channel.port1.on("message", fn),
    ackTimeout: 1000,
    timeout: 5000,
  });

  // Should work normally - alice will send ACK and then response
  const result = await bob.hello("Bob");
  expect(result).toBe("Hello Bob, my name is Alice");
});

it("custom onAckTimeoutError handler", async () => {
  const channel = new MessageChannel();
  const onAckTimeout = vi.fn();

  const bob = createBirpc<AliceFunctions, BobFunctions>(Bob, {
    post: (data) => channel.port1.postMessage(data),
    on: (fn) => channel.port1.on("message", fn),
    ackTimeout: 100,
    onAckTimeoutError(functionName, args) {
      onAckTimeout({ functionName, args });
      throw new Error("Custom ack timeout error");
    },
  });

  try {
    await bob.hello("Bob");
    expect.fail("Should have thrown");
  } catch (e) {
    expect(onAckTimeout).toHaveBeenCalledWith({
      functionName: "hello",
      args: ["Bob"],
    });
    expect((e as Error).message).toBe("Custom ack timeout error");
  }
});

it("custom onAckTimeoutError returns true to suppress error", async () => {
  const channel = new MessageChannel();
  const onAckTimeout = vi.fn();

  const bob = createBirpc<AliceFunctions, BobFunctions>(Bob, {
    post: (data) => channel.port1.postMessage(data),
    on: (fn) => channel.port1.on("message", fn),
    ackTimeout: 100,
    onAckTimeoutError(functionName, args) {
      onAckTimeout({ functionName, args });
      return true; // Suppress error
    },
  });

  // Should not throw since error is suppressed
  // The call will hang and eventually cleanup
  const promise = bob.hello("Bob");

  // Wait for ack timeout to fire
  await new Promise((resolve) => setTimeout(resolve, 150));

  expect(onAckTimeout).toHaveBeenCalledWith({
    functionName: "hello",
    args: ["Bob"],
  });
});

it("response timeout starts after ack when ackTimeout is set", async () => {
  const channel = new MessageChannel();

  // Create alice that sends ACK but delays response
  const slowAlice = {
    hello: async (name: string) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return `Hello ${name}, my name is Alice`;
    },
  };

  const alice = createBirpc<BobFunctions, typeof slowAlice>(slowAlice, {
    post: (data) => channel.port2.postMessage(data),
    on: (fn) => channel.port2.on("message", fn),
  });

  const bob = createBirpc<typeof slowAlice, BobFunctions>(Bob, {
    post: (data) => channel.port1.postMessage(data),
    on: (fn) => channel.port1.on("message", fn),
    ackTimeout: 1000,
    timeout: 100, // Response timeout is shorter than alice's delay
  });

  try {
    await bob.hello("Bob");
    expect.fail("Should have thrown timeout error");
  } catch (e) {
    expect((e as Error).message).toContain('timeout on calling "hello"');
    // Should NOT be ack timeout since ACK was received
    expect((e as Error).message).not.toContain("ack timeout");
  }
});

it("no ackTimeout means response timeout starts immediately", async () => {
  const channel = new MessageChannel();

  const bob = createBirpc<AliceFunctions, BobFunctions>(Bob, {
    post: (data) => channel.port1.postMessage(data),
    on: (fn) => channel.port1.on("message", fn),
    timeout: 100, // No ackTimeout
  });

  try {
    await bob.hello("Bob");
    expect.fail("Should have thrown timeout error");
  } catch (e) {
    expect((e as Error).message).toContain('timeout on calling "hello"');
  }
});

it("multiple concurrent calls with ack timeout", async () => {
  const channel = new MessageChannel();

  const alice = createBirpc<BobFunctions, AliceFunctions>(
    {
      hello: async (name: string) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return `Hello ${name}, my name is Alice`;
      },
    },
    {
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
    },
  );

  const bob = createBirpc<AliceFunctions, BobFunctions>(Bob, {
    post: (data) => channel.port1.postMessage(data),
    on: (fn) => channel.port1.on("message", fn),
    ackTimeout: 1000,
    timeout: 5000,
  });

  // Multiple concurrent calls should all work
  const results = await Promise.all([
    bob.hello("Alice"),
    bob.hello("Bob"),
    bob.hello("Charlie"),
  ]);

  expect(results).toEqual([
    "Hello Alice, my name is Alice",
    "Hello Bob, my name is Alice",
    "Hello Charlie, my name is Alice",
  ]);
});

it("close during ack wait rejects with close error", async () => {
  const channel = new MessageChannel();

  const bob = createBirpc<AliceFunctions, BobFunctions>(Bob, {
    post: (data) => channel.port1.postMessage(data),
    on: (fn) => channel.port1.on("message", fn),
    ackTimeout: 5000,
    timeout: 10000,
  });

  const promise = bob.hello("Bob");

  // Close before ack is received
  await new Promise((resolve) => setTimeout(resolve, 10));
  bob.$close();

  try {
    await promise;
    expect.fail("Should have thrown");
  } catch (e) {
    expect((e as Error).message).toContain("closed");
  }
});

it("event calls work without ack", async () => {
  const channel = new MessageChannel();
  let bumpCalled = false;

  const bob = createBirpc<{ bump: () => void }, BobFunctions>(
    {
      ...Bob,
    },
    {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
      ackTimeout: 100,
      timeout: 5000,
    },
  );

  const alice = createBirpc<BobFunctions, { bump: () => void }>(
    {
      bump: () => {
        bumpCalled = true;
      },
    },
    {
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
      eventNames: ["bump"],
    },
  );

  // Event calls should work (no ack needed for events)
  await bob.bump.asEvent();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(bumpCalled).toBe(true);
});

it("$callOptional with ack timeout works", async () => {
  const channel = new MessageChannel();

  const alice = createBirpc<BobFunctions, AliceFunctions>(
    { hello: (name: string) => `Hello ${name}` },
    {
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
    },
  );

  const bob = createBirpc<AliceFunctions, BobFunctions>(Bob, {
    post: (data) => channel.port1.postMessage(data),
    on: (fn) => channel.port1.on("message", fn),
    ackTimeout: 1000,
    timeout: 5000,
  });

  // @ts-expect-error - nonexistent is not defined
  const result = await bob.$callOptional("nonexistent", "test");
  expect(result).toBeUndefined();
});

it("ack timeout of 0 still requires ack", async () => {
  const channel = new MessageChannel();

  const bob = createBirpc<AliceFunctions, BobFunctions>(Bob, {
    post: (data) => channel.port1.postMessage(data),
    on: (fn) => channel.port1.on("message", fn),
    ackTimeout: 0, // 0 means immediate timeout
    timeout: 5000,
  });

  try {
    await bob.hello("Bob");
    expect.fail("Should have thrown");
  } catch (e) {
    expect((e as Error).message).toContain("ack timeout");
  }
});

it("ack received before timeout clears ack timer", async () => {
  const channel = new MessageChannel();
  const onAckTimeout = vi.fn();

  const alice = createBirpc<BobFunctions, AliceFunctions>(
    {
      hello: async (name: string) => {
        // Slow response, but ACK is immediate
        await new Promise((resolve) => setTimeout(resolve, 200));
        return `Hello ${name}`;
      },
    },
    {
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
    },
  );

  const bob = createBirpc<AliceFunctions, BobFunctions>(Bob, {
    post: (data) => channel.port1.postMessage(data),
    on: (fn) => channel.port1.on("message", fn),
    ackTimeout: 100, // ACK should arrive before this
    timeout: 5000, // Response timeout is long enough
    onAckTimeoutError: onAckTimeout,
  });

  const result = await bob.hello("Bob");

  // ACK timeout should NOT have been called
  expect(onAckTimeout).not.toHaveBeenCalled();
  expect(result).toBe("Hello Bob");
});
