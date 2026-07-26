import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { RegistrationForm } from "@/components/registration-form";
import { registrationConfiguration } from "@/lib/server/config";

afterEach(() => cleanup());

describe("registration configuration gate", () => {
  it("disables payment and shows a clear state when contracts are not configured", () => {
    render(<RegistrationForm registrationEnabled={false} />);
    expect(screen.getByRole("button", { name: "Register with 2 USDT" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "BSC Testnet registration configuration is incomplete",
    );
  });

  it("reports missing configuration by variable name without values", () => {
    const previous = { ...process.env };
    delete process.env.SMART_EARNING_CONTRACT_ADDRESS;
    try {
      const result = registrationConfiguration();
      expect(result.enabled).toBe(false);
      expect(result.missing).toContain("SMART_EARNING_CONTRACT_ADDRESS");
    } finally {
      process.env = previous;
    }
  });
});
