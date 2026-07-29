import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/client/wallet", () => ({
  walletLogin: vi.fn(),
  registerOnTestnet: vi.fn(),
}));

import { RegistrationForm } from "@/components/registration-form";

afterEach(cleanup);

describe("compact landing registration form", () => {
  it("shows only the sponsor field and full-width Signup action at rest", () => {
    const sponsor = "0x1234567890abcdef1234567890abcdef12345678";
    const { container } = render(<RegistrationForm registrationEnabled initialSponsor={sponsor} />);

    expect(screen.getByLabelText("Sponsor Wallet")).toHaveValue(sponsor);
    expect(screen.getByRole("button", { name: "Signup" })).toHaveClass("rounded-xl", "bg-gold");
    expect(screen.queryByText("Registration")).not.toBeInTheDocument();
    expect(screen.queryByText(/Network fee/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unified contract/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Testnet|chain ID|treasury|Magic accounting|BNB gas/i)).not.toBeInTheDocument();
    expect(container.querySelector("form")).toHaveClass("grid", "gap-3");
  });
});
