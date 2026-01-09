import type { Thenable } from "../src/utils";
import { MessageChannel } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { createBirpc } from "../src/main";
import * as Alice from "./alice";
import * as Bob from "./bob";

type BobFunctions = typeof Bob;
type AliceFunctions = typeof Alice;

// Layered function types for resolver tests
interface LayeredFunctions {
  admin: {
    getSecret(): string;
  };
  public: {
    getData(): string;
  };
}

it("resolver", async () => {
  const channel = new MessageChannel();

  const bob = createBirpc<AliceFunctions, BobFunctions>(
    { ...Bob },
    {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
    },
  );

  let customResolverFn:
    | Thenable<((...args: any[]) => any) | undefined>
    | undefined;

  const alice = createBirpc<BobFunctions, AliceFunctions>(
    { ...Alice },
    {
      // mark bob's `bump` as an event without response
      eventNames: ["bump"],
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
      resolver: (name, fn) => {
        if (name === "foo") return customResolverFn;
        return fn;
      },
    },
  );

  // RPCs
  expect(await bob.hello("Bob")).toEqual("Hello Bob, my name is Alice");
  expect(await alice.hi("Alice")).toEqual("Hi Alice, I am Bob");

  // @ts-expect-error `foo` is not defined
  await expect(bob.foo("Bob")).rejects.toThrow(
    '[birpc] function "foo" not found',
  );

  customResolverFn = Promise.resolve(
    (a: string) => `Custom resolve function to ${a}`,
  );

  // @ts-expect-error `foo` is not defined
  expect(await bob.foo("Bob")).toBe("Custom resolve function to Bob");
});

describe("layered API resolver", () => {
  it("resolver with layered function paths", async () => {
    const channel = new MessageChannel();

    const serverFunctions = {
      admin: {
        getSecret() {
          return "secret-data";
        },
      },
      public: {
        getData() {
          return "public-data";
        },
      },
    };

    let customResolverFn:
      | Thenable<((...args: any[]) => any) | undefined>
      | undefined;

    const _server = createBirpc<{}, typeof serverFunctions>(serverFunctions, {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
      resolver: (name, fn) => {
        // Block admin functions
        if (name.startsWith("admin.")) {
          return customResolverFn;
        }
        return fn;
      },
    });

    const client = createBirpc<LayeredFunctions, {}>(
      {},
      {
        post: (data) => channel.port2.postMessage(data),
        on: (fn) => channel.port2.on("message", fn),
      },
    );

    // Public functions work normally
    expect(await client.public.getData()).toBe("public-data");

    // Admin functions are blocked by default
    await expect(client.admin.getSecret()).rejects.toThrow(
      '[birpc] function "admin.getSecret" not found',
    );

    // Enable admin functions via resolver
    customResolverFn = Promise.resolve(() => "allowed-secret");
    expect(await client.admin.getSecret()).toBe("allowed-secret");
  });
});
