import { afterEach, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findAvailablePort,
  startDevServer,
  type DevServer,
} from "../lib/dev-server/server";

const directory = mkdtempSync(join(tmpdir(), "fusebase-bind-test-"));
const paths = {
  sessionDir: directory,
  browserDebugPath: join(directory, "browser.jsonl"),
  accessLogsPath: join(directory, "access.jsonl"),
  backendOutputPath: join(directory, "backend.jsonl"),
  frontendDevServerPath: join(directory, "frontend.jsonl"),
};
let server: DevServer | undefined;
let restoreServe: (() => void) | undefined;
afterEach(async () => {
  restoreServe?.();
  await server?.close();
  server = undefined;
  rmSync(directory, { recursive: true, force: true });
});

it("retries when a competing CLI binds a port after its availability probe", async () => {
  const firstPort = await findAvailablePort(39000);
  const serve = spyOn(Bun, "serve");
  restoreServe = () => serve.mockRestore();
  serve.mockImplementationOnce(() => {
    throw Object.assign(new Error("Port was taken"), { code: "EADDRINUSE" });
  });
  server = await startDevServer(paths, firstPort);
  expect(server.port).toBeGreaterThan(firstPort);
  expect(serve).toHaveBeenCalledTimes(2);
});

it("does not hide unrelated server startup failures", async () => {
  const serve = spyOn(Bun, "serve");
  restoreServe = () => serve.mockRestore();
  const failure = Object.assign(new Error("Permission denied"), {
    code: "EACCES",
  });
  serve.mockImplementationOnce(() => {
    throw failure;
  });
  await expect(startDevServer(paths, 39000)).rejects.toBe(failure);
  expect(serve).toHaveBeenCalledTimes(1);
});
