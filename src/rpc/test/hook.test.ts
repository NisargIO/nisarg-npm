import type { EventOptions } from "../src";
import { MessageChannel } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { createBirpc } from "../src/main";
import * as Alice from "./alice";
import * as Bob from "./bob";

type BobFunctions = typeof Bob;
type AliceFunctions = typeof Alice;

// Layered function types for hook tests
interface LayeredFunctions {
  api: {
    getData(key: string): string;
  };
}

const mockFn = {
  trigger() {},
};

function createChannel(
  options: {
    onRequest?: EventOptions<BobFunctions, AliceFunctions>["onRequest"];
  } = {},
) {
  const channel = new MessageChannel();
  const { onRequest = () => {} } = options;
  return {
    channel,
    alice: createBirpc<BobFunctions, AliceFunctions>(Alice, {
      onRequest,
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => {
        channel.port2.on("message", fn);
      },
    }),
    bob: createBirpc<AliceFunctions, BobFunctions>(Bob, {
      post: (data) => {
        return channel.port1.postMessage(data);
      },
      on: (fn) =>
        channel.port1.on("message", (...args) => {
          mockFn.trigger();
          fn(...args);
        }),
    }),
  };
}

it("cache", async () => {
  const spy = vi.spyOn(mockFn, "trigger");
  const cacheMap = new Map<string, string>();
  const { alice } = createChannel({
    onRequest: async (req, next, send) => {
      const key = `${req.m}-${req.a?.join("-")}`;
      if (!cacheMap.has(key)) {
        cacheMap.set(key, await next());
      } else {
        send(cacheMap.get(key));
      }
    },
  });
  expect(cacheMap).toMatchInlineSnapshot(`Map {}`);
  expect(await alice.hi("Alice")).toBe("Hi Alice, I am Bob");
  expect(spy).toBeCalledTimes(1);
  expect(await alice.hi("Alice")).toBe("Hi Alice, I am Bob");
  expect(spy).toBeCalledTimes(1);
  expect(await alice.hi("Alex")).toBe("Hi Alex, I am Bob");
  expect(spy).toBeCalledTimes(2);
  expect(await alice.hi("Alex")).toBe("Hi Alex, I am Bob");
  expect(spy).toBeCalledTimes(2);
  expect(await alice.getCount()).toBe(0);
  expect(spy).toBeCalledTimes(3);
  expect(cacheMap).toMatchInlineSnapshot(`
    Map {
      "hi-Alice" => "Hi Alice, I am Bob",
      "hi-Alex" => "Hi Alex, I am Bob",
      "getCount-" => 0,
    }
  `);
});

describe("layered API hooks", () => {
  it("onRequest hook with layered calls", async () => {
    const channel = new MessageChannel();
    const onRequestSpy = vi.fn();

    const serverFunctions = {
      api: {
        getData(key: string) {
          return `value-for-${key}`;
        },
      },
    };

    const _server = createBirpc<{}, typeof serverFunctions>(serverFunctions, {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
    });

    const client = createBirpc<LayeredFunctions, {}>(
      {},
      {
        post: (data) => channel.port2.postMessage(data),
        on: (fn) => channel.port2.on("message", fn),
        onRequest: async (req, next) => {
          onRequestSpy(req.m, req.a);
          return next();
        },
      },
    );

    const result = await client.api.getData("test-key");
    expect(result).toBe("value-for-test-key");
    expect(onRequestSpy).toHaveBeenCalledWith("api.getData", ["test-key"]);
  });

  it("cache with layered calls", async () => {
    const channel = new MessageChannel();
    const callSpy = vi.fn();

    const serverFunctions = {
      api: {
        getData(key: string) {
          callSpy(key);
          return `data-${key}`;
        },
      },
    };

    const _server = createBirpc<{}, typeof serverFunctions>(serverFunctions, {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
    });

    const cacheMap = new Map<string, any>();

    const client = createBirpc<LayeredFunctions, {}>(
      {},
      {
        post: (data) => channel.port2.postMessage(data),
        on: (fn) => channel.port2.on("message", fn),
        onRequest: async (req, next, send) => {
          const cacheKey = `${req.m}-${req.a?.join("-")}`;
          if (cacheMap.has(cacheKey)) {
            send(cacheMap.get(cacheKey));
          } else {
            const result = await next();
            cacheMap.set(cacheKey, result);
          }
        },
      },
    );

    // First call - hits server
    expect(await client.api.getData("key1")).toBe("data-key1");
    expect(callSpy).toHaveBeenCalledTimes(1);

    // Second call with same args - uses cache
    expect(await client.api.getData("key1")).toBe("data-key1");
    expect(callSpy).toHaveBeenCalledTimes(1);

    // Different key - hits server again
    expect(await client.api.getData("key2")).toBe("data-key2");
    expect(callSpy).toHaveBeenCalledTimes(2);
  });
});
