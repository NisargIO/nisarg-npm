import { describe, expect, it } from "vitest";
import { createBirpc } from "../src/main";

// Layered function types for reject-pending-calls tests
interface LayeredFunctions {
  service: {
    pendingCall(): Promise<void>;
  };
}

it("rejects pending calls", async () => {
  const rpc = createBirpc<{
    first: () => Promise<void>;
    second: () => Promise<void>;
  }>(
    {},
    {
      on() {},
      post() {},
    },
  );

  const promises = [
    rpc
      .first()
      .then(() => expect.fail("first() should not resolve"))
      .catch((error) => error),

    rpc
      .second()
      .then(() => expect.fail("second() should not resolve"))
      .catch((error) => error),
  ];

  const rejections = rpc.$rejectPendingCalls();
  expect(rejections).toHaveLength(2);

  const errors = await Promise.all(promises);
  expect(errors).toHaveLength(2);

  expect
    .soft(errors[0].message)
    .toBe('[birpc]: rejected pending call "first".');
  expect
    .soft(errors[1].message)
    .toBe('[birpc]: rejected pending call "second".');
});

it("rejects pending calls with custom handler", async () => {
  const rpc = createBirpc<{
    first: () => Promise<void>;
    second: () => Promise<void>;
  }>(
    {},
    {
      on() {},
      post() {},
    },
  );

  const promises = [
    rpc
      .first()
      .then(() => expect.fail("first() should not resolve"))
      .catch((error) => error),

    rpc
      .second()
      .then(() => expect.fail("second() should not resolve"))
      .catch((error) => error),
  ];

  const rejections = rpc.$rejectPendingCalls(({ method, reject }) =>
    reject(new Error(`Rejected call. Method: "${method}".`)),
  );
  expect(rejections).toHaveLength(2);

  const errors = await Promise.all(promises);
  expect(errors).toHaveLength(2);

  expect.soft(errors[0].message).toBe('Rejected call. Method: "first".');
  expect.soft(errors[1].message).toBe('Rejected call. Method: "second".');
});

it("rejected calls are cleared from rpc", async () => {
  const rpc = createBirpc<{ stuck: () => Promise<void> }>(
    {},
    {
      on() {},
      post() {},
    },
  );

  rpc
    .stuck()
    .then(() => expect.fail("stuck() should not resolve"))
    .catch(() => undefined);

  {
    const rejections = rpc.$rejectPendingCalls(({ reject }) =>
      reject(new Error("Rejected")),
    );
    expect(rejections).toHaveLength(1);
  }

  {
    const rejections = rpc.$rejectPendingCalls(({ reject }) =>
      reject(new Error("Rejected")),
    );
    expect(rejections).toHaveLength(0);
  }
});

describe("layered API reject pending calls", () => {
  it("rejects layered pending calls", async () => {
    const rpc = createBirpc<LayeredFunctions>(
      {},
      {
        on() {},
        post() {},
      },
    );

    const promise = rpc.service
      .pendingCall()
      .then(() => expect.fail("Should not resolve"))
      .catch((error) => error);

    const rejections = rpc.$rejectPendingCalls();
    expect(rejections).toHaveLength(1);

    const error = await promise;
    expect(error.message).toBe(
      '[birpc]: rejected pending call "service.pendingCall".',
    );
  });

  it("rejects layered pending calls with custom handler", async () => {
    const rpc = createBirpc<LayeredFunctions>(
      {},
      {
        on() {},
        post() {},
      },
    );

    const promise = rpc.service
      .pendingCall()
      .then(() => expect.fail("Should not resolve"))
      .catch((error) => error);

    const rejections = rpc.$rejectPendingCalls(({ method, reject }) =>
      reject(new Error(`Custom rejection for "${method}"`)),
    );
    expect(rejections).toHaveLength(1);

    const error = await promise;
    expect(error.message).toBe('Custom rejection for "service.pendingCall"');
  });
});
