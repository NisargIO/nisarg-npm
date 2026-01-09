import { MessageChannel } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { createBirpc } from "../src/main";
import * as Alice from "./alice";
import * as Bob from "./bob";

type BobFunctions = typeof Bob;
type AliceFunctions = typeof Alice;

// Layered function types for dynamic tests
interface LayeredFunctions {
  api: {
    getData(): string;
    nested: {
      getValue(): number;
    };
  };
}

it("dynamic", async () => {
  const channel = new MessageChannel();

  const bob = createBirpc<AliceFunctions, BobFunctions>(
    { ...Bob },
    {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
    },
  );

  const alice = createBirpc<BobFunctions, AliceFunctions>(
    { ...Alice },
    {
      // mark bob's `bump` as an event without response
      eventNames: ["bump"],
      post: (data) => channel.port2.postMessage(data),
      on: (fn) => channel.port2.on("message", fn),
    },
  );

  // RPCs
  expect(await bob.hello("Bob")).toEqual("Hello Bob, my name is Alice");
  expect(await alice.hi("Alice")).toEqual("Hi Alice, I am Bob");

  // replace Alice's `hello` function
  alice.$functions.hello = (name: string) => {
    return `Alice says hello to ${name}`;
  };

  expect(await bob.hello("Bob")).toEqual("Alice says hello to Bob");

  // Adding new functions
  // @ts-expect-error `foo` is not defined
  alice.$functions.foo = async (name: string) => {
    return `A random function, called by ${name}`;
  };

  // @ts-expect-error `foo` is not defined
  expect(await bob.foo("Bob")).toEqual("A random function, called by Bob");
});

describe("layered API dynamic", () => {
  it("dynamically modify layered functions", async () => {
    const channel = new MessageChannel();

    const serverFunctions = {
      api: {
        getData() {
          return "original-data";
        },
        nested: {
          getValue() {
            return 42;
          },
        },
      },
    };

    const server = createBirpc<{}, typeof serverFunctions>(serverFunctions, {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
    });

    const client = createBirpc<LayeredFunctions, {}>(
      {},
      {
        post: (data) => channel.port2.postMessage(data),
        on: (fn) => channel.port2.on("message", fn),
      },
    );

    // Original functions
    expect(await client.api.getData()).toBe("original-data");
    expect(await client.api.nested.getValue()).toBe(42);

    // Modify layered function
    server.$functions.api.getData = () => "modified-data";
    expect(await client.api.getData()).toBe("modified-data");

    // Modify deeply nested function
    server.$functions.api.nested.getValue = () => 100;
    expect(await client.api.nested.getValue()).toBe(100);
  });

  it("add new layered functions dynamically", async () => {
    const channel = new MessageChannel();

    const serverFunctions: any = {
      api: {
        getData() {
          return "data";
        },
      },
    };

    const server = createBirpc<{}, typeof serverFunctions>(serverFunctions, {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
    });

    const client = createBirpc<LayeredFunctions, {}>(
      {},
      {
        post: (data) => channel.port2.postMessage(data),
        on: (fn) => channel.port2.on("message", fn),
      },
    );

    // Add new nested namespace
    server.$functions.api.nested = {
      getValue() {
        return 999;
      },
    };

    expect(await client.api.nested.getValue()).toBe(999);
  });
});
