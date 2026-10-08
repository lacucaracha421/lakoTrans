import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("cancels document replacement before parser teardown while retaining same-document navigation", async () => {
  const addEventListener = vi.fn();
  const frame = { top: {}, navigation: { addEventListener } };
  frame.top = frame;
  vi.stubGlobal("window", frame);
  await import("../src/main/webImportNavigationPreload");
  expect(addEventListener).toHaveBeenCalledOnce();
  const [name, handle] = addEventListener.mock.calls[0];
  expect(name).toBe("navigate");
  for (const [sameDocument, cancelable, cancelled] of [
    [false, true, true],
    [true, true, false],
    [false, false, false],
  ]) {
    const event = {
      destination: { sameDocument },
      cancelable,
      preventDefault: vi.fn(),
    };
    handle(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(cancelled ? 1 : 0);
  }
});

it("leaves iframe navigation to the frame and retains the browser guard when the Navigation API is absent", async () => {
  const addEventListener = vi.fn();
  vi.stubGlobal("window", { top: {}, navigation: { addEventListener } });
  await import("../src/main/webImportNavigationPreload");
  expect(addEventListener).not.toHaveBeenCalled();
  vi.resetModules();
  const frame = { top: {} };
  frame.top = frame;
  vi.stubGlobal("window", frame);
  await expect(
    import("../src/main/webImportNavigationPreload"),
  ).resolves.toBeDefined();
});
