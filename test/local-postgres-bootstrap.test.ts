// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const { ensureLocalPostgres } = require("../scripts/local-postgres.cjs");
const url = "postgresql://postgres:postgres@localhost:5433/smartearning";

function container(running: boolean, health?: string) {
  return [{
    State: { Running: running, ...(health ? { Health: { Status: health } } : {}) },
    HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: "5433" }] } },
  }];
}

describe("local PostgreSQL dependency bootstrap", () => {
  it("creates and health-checks PostgreSQL on a fresh machine", async () => {
    let created = false;
    const runDocker = vi.fn(async (args: string[]) => {
      if (args[0] === "inspect") {
        if (!created) throw new Error("No such object: smart-earning-postgres");
        return JSON.stringify(container(true, "healthy"));
      }
      if (args[0] === "run") created = true;
      return "";
    });

    await expect(ensureLocalPostgres(url, {
      runDocker, connects: async () => true, pause: async () => undefined,
    })).resolves.toMatchObject({ action: "created", health: "healthy" });
    expect(runDocker).toHaveBeenCalledWith(expect.arrayContaining([
      "run", "-d", "--name", "smart-earning-postgres", "-p", "5433:5432",
    ]));
  });

  it("starts a stopped container and verifies connectivity", async () => {
    let running = false;
    const runDocker = vi.fn(async (args: string[]) => {
      if (args[0] === "inspect") return JSON.stringify(container(running));
      if (args[0] === "start") running = true;
      return "";
    });
    const connects = vi.fn(async () => true);

    await expect(ensureLocalPostgres(url, { runDocker, connects }))
      .resolves.toMatchObject({ action: "started", health: "connectable" });
    expect(runDocker).toHaveBeenCalledWith(["start", "smart-earning-postgres"]);
    expect(connects).toHaveBeenCalledOnce();
  });

  it("reuses an already-running healthy container", async () => {
    const runDocker = vi.fn(async (_args: string[]) => JSON.stringify(container(true, "healthy")));

    await expect(ensureLocalPostgres(url, { runDocker, connects: async () => true }))
      .resolves.toMatchObject({ action: "already running", health: "healthy" });
    expect(runDocker.mock.calls.every(([args]) => args[0] === "inspect")).toBe(true);
  });
});
