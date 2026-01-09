import { MessageChannel } from "node:worker_threads";
import { expect, it, describe } from "vitest";
import { createBirpc } from "../src/main";

// Define nested function types for testing
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
  // Flat function at root level (for backwards compatibility)
  ping(): string;
}

interface ClientFunctions {
  notify(message: string): void;
  events: {
    onUserLogin(userId: number): void;
  };
}

function createChannel() {
  const channel = new MessageChannel();

  const serverFunctions = {
    user: {
      getToken() {
        return "token-123";
      },
      getProfile(id: number) {
        return { id, name: `User ${id}` };
      },
      settings: {
        get(key: string) {
          return `value-for-${key}`;
        },
        set(_key: string, _value: string) {
          // no-op
        },
      },
    },
    auth: {
      login(username: string, _password: string) {
        return username === "admin";
      },
      logout() {
        // no-op
      },
    },
    ping() {
      return "pong";
    },
  };

  const clientFunctions = {
    notify(_message: string) {
      // no-op
    },
    events: {
      onUserLogin(_userId: number) {
        // no-op
      },
    },
  };

  return {
    channel,
    server: createBirpc<ClientFunctions, typeof serverFunctions>(
      serverFunctions,
      {
        post: (data) => channel.port1.postMessage(data),
        on: (fn) => channel.port1.on("message", fn),
      },
    ),
    client: createBirpc<ServerFunctions, typeof clientFunctions>(
      clientFunctions,
      {
        post: (data) => channel.port2.postMessage(data),
        on: (fn) => channel.port2.on("message", fn),
      },
    ),
  };
}

describe("layered RPC calls", () => {
  it("should call single-level nested functions", async () => {
    const { client } = createChannel();

    const token = await client.user.getToken();
    expect(token).toBe("token-123");

    const profile = await client.user.getProfile(42);
    expect(profile).toEqual({ id: 42, name: "User 42" });
  });

  it("should call deeply nested functions", async () => {
    const { client } = createChannel();

    const value = await client.user.settings.get("theme");
    expect(value).toBe("value-for-theme");

    // set returns void
    await client.user.settings.set("theme", "dark");
  });

  it("should call root-level functions (backwards compatibility)", async () => {
    const { client } = createChannel();

    const result = await client.ping();
    expect(result).toBe("pong");
  });

  it("should call nested functions in different namespaces", async () => {
    const { client } = createChannel();

    const loginResult = await client.auth.login("admin", "password");
    expect(loginResult).toBe(true);

    const loginFailed = await client.auth.login("user", "password");
    expect(loginFailed).toBe(false);

    await client.auth.logout();
  });

  it("should support asEvent on nested functions", async () => {
    const { client } = createChannel();

    // Fire-and-forget should return undefined
    const result = await client.auth.logout.asEvent();
    expect(result).toBeUndefined();
  });

  it("should work with $call using dot notation", async () => {
    const { client } = createChannel();

    // @ts-expect-error - $call expects keyof RemoteFunctions, but dot notation works at runtime
    const token = await client.$call("user.getToken");
    expect(token).toBe("token-123");

    // @ts-expect-error - $call expects keyof RemoteFunctions
    const value = await client.$call("user.settings.get", "language");
    expect(value).toBe("value-for-language");
  });

  it("should return error for non-existent nested functions", async () => {
    const { client } = createChannel();

    // @ts-expect-error - nonExistent is not defined
    await expect(client.user.nonExistent()).rejects.toThrow(
      '[birpc] function "user.nonExistent" not found',
    );
  });

  it("should return error for accessing non-existent namespace", async () => {
    const { client } = createChannel();

    // @ts-expect-error - nonExistent namespace is not defined
    await expect(client.nonExistent.method()).rejects.toThrow(
      '[birpc] function "nonExistent.method" not found',
    );
  });
});

describe("layered RPC with streams", () => {
  it("should support asStream on nested functions", async () => {
    const channel = new MessageChannel();

    const serverFunctions = {
      data: {
        async *streamNumbers(count: number) {
          for (let i = 0; i < count; i++) {
            yield i;
          }
        },
      },
    };

    interface ServerFns {
      data: {
        streamNumbers(count: number): AsyncIterable<number>;
      };
    }

    createBirpc<object, typeof serverFunctions>(serverFunctions, {
      post: (data) => channel.port1.postMessage(data),
      on: (fn) => channel.port1.on("message", fn),
    });

    const client = createBirpc<ServerFns, object>(
      {},
      {
        post: (data) => channel.port2.postMessage(data),
        on: (fn) => channel.port2.on("message", fn),
      },
    );

    const numbers: number[] = [];
    for await (const num of client.data.streamNumbers.asStream(5)) {
      numbers.push(num);
    }

    expect(numbers).toEqual([0, 1, 2, 3, 4]);
  });
});
