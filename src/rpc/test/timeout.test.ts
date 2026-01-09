import type * as Alice from "./alice";
import { MessageChannel } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { createBirpc } from "../src/main";
import * as Bob from "./bob";

type AliceFunctions = typeof Alice;
type BobFunctions = typeof Bob;

// Layered function types for timeout tests
interface LayeredFunctions {
  api: {
    slowCall(): string;
  };
}

it("timeout", async () => {
  const channel = new MessageChannel();

  const bob = createBirpc<AliceFunctions, BobFunctions>(Bob, {
    post: (data) => channel.port1.postMessage(data),
    on: (fn) => channel.port1.on("message", fn),
    timeout: 100,
  });

  try {
    await bob.hello("Bob");
    expect(1).toBe(2);
  } catch (e) {
    expect(e).toMatchInlineSnapshot(
      '[Error: [birpc] timeout on calling "hello"]',
    );
  }
});

it("custom onTimeoutError", async () => {
  const channel = new MessageChannel();
  const onTimeout = vi.fn();

  const bob = createBirpc<AliceFunctions, BobFunctions>(Bob, {
    post: (data) => channel.port1.postMessage(data),
    on: (fn) => channel.port1.on("message", fn),
    timeout: 100,
    onTimeoutError(functionName, args) {
      onTimeout({ functionName, args });
      throw new Error("Custom error");
    },
  });

  try {
    await bob.hello("Bob");
    expect(1).toBe(2);
  } catch (e) {
    expect(onTimeout).toHaveBeenCalledWith({
      functionName: "hello",
      args: ["Bob"],
    });
    expect(e).toMatchInlineSnapshot(`[Error: Custom error]`);
  }
});

it("custom onTimeoutError without custom error", async () => {
  const channel = new MessageChannel();
  const onTimeout = vi.fn();

  const bob = createBirpc<AliceFunctions, BobFunctions>(Bob, {
    post: (data) => channel.port1.postMessage(data),
    on: (fn) => channel.port1.on("message", fn),
    timeout: 100,
    onTimeoutError(functionName, args) {
      onTimeout({ functionName, args });
    },
  });

  try {
    await bob.hello("Bob");
    expect(1).toBe(2);
  } catch (e) {
    expect(onTimeout).toHaveBeenCalledWith({
      functionName: "hello",
      args: ["Bob"],
    });
    expect(e).toMatchInlineSnapshot(
      `[Error: [birpc] timeout on calling "hello"]`,
    );
  }
});

describe("layered API timeout", () => {
  it("timeout on layered call", async () => {
    const channel = new MessageChannel();

    const client = createBirpc<LayeredFunctions, {}>(
      {},
      {
        post: (data) => channel.port1.postMessage(data),
        on: (fn) => channel.port1.on("message", fn),
        timeout: 100,
      },
    );

    try {
      await client.api.slowCall();
      expect.fail("Should have thrown timeout error");
    } catch (e) {
      expect((e as Error).message).toBe(
        '[birpc] timeout on calling "api.slowCall"',
      );
    }
  });

  it("custom onTimeoutError with layered call", async () => {
    const channel = new MessageChannel();
    const onTimeout = vi.fn();

    const client = createBirpc<LayeredFunctions, {}>(
      {},
      {
        post: (data) => channel.port1.postMessage(data),
        on: (fn) => channel.port1.on("message", fn),
        timeout: 100,
        onTimeoutError(functionName, args) {
          onTimeout({ functionName, args });
          throw new Error("Custom layered timeout error");
        },
      },
    );

    try {
      await client.api.slowCall();
      expect.fail("Should have thrown");
    } catch (e) {
      expect(onTimeout).toHaveBeenCalledWith({
        functionName: "api.slowCall",
        args: [],
      });
      expect((e as Error).message).toBe("Custom layered timeout error");
    }
  });
});
