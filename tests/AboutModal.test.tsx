import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AboutModal from "../components/AboutModal";

describe("AboutModal", () => {
  it("should not render when isOpen is false", () => {
    const onClose = vi.fn();
    const { container } = render(
      <AboutModal isOpen={false} onClose={onClose} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("should render when isOpen is true", () => {
    const onClose = vi.fn();
    render(<AboutModal isOpen={true} onClose={onClose} />);
    expect(screen.getByText("About NebulaTerm AI")).toBeInTheDocument();
  });

  it("should display version information", () => {
    const onClose = vi.fn();
    render(<AboutModal isOpen={true} onClose={onClose} />);
    expect(screen.getByText("NebulaTerm AI")).toBeInTheDocument();
    expect(screen.getByText("Version 1.0.13")).toBeInTheDocument();
    expect(
      screen.getByText("Next-Generation SSH Terminal Client")
    ).toBeInTheDocument();
  });

  it("should display company information", () => {
    const onClose = vi.fn();
    render(<AboutModal isOpen={true} onClose={onClose} />);
    expect(screen.getByText("Quantum Billing, LLC")).toBeInTheDocument();
    expect(screen.getByText("13802 NE Airport Way")).toBeInTheDocument();
    expect(screen.getByText("Portland, OR, 97230")).toBeInTheDocument();
  });

  it("should display contact information", () => {
    const onClose = vi.fn();
    render(<AboutModal isOpen={true} onClose={onClose} />);

    const emailLink = screen.getByText("info@qb-solutions.us");
    expect(emailLink).toBeInTheDocument();
    expect(emailLink).toHaveAttribute("href", "mailto:info@qb-solutions.us");

    const phoneLink = screen.getByText("+1 409 934 7680");
    expect(phoneLink).toBeInTheDocument();
    expect(phoneLink).toHaveAttribute("href", "tel:+14099347680");
  });

  it("should display website link", () => {
    const onClose = vi.fn();
    render(<AboutModal isOpen={true} onClose={onClose} />);

    const websiteLink = screen.getByText("nebulaterm-ai.quantum-billing.com");
    expect(websiteLink).toBeInTheDocument();
    expect(websiteLink).toHaveAttribute(
      "href",
      "https://nebulaterm-ai.quantum-billing.com/"
    );
    expect(websiteLink).toHaveAttribute("target", "_blank");
  });

  it("should call onClose when X button is clicked", () => {
    const onClose = vi.fn();
    render(<AboutModal isOpen={true} onClose={onClose} />);

    // There are two close buttons (X and Close), find the X button
    const closeButtons = screen.getAllByRole("button");
    const xButton = closeButtons[0]; // The X button is first

    fireEvent.click(xButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should call onClose when Close button is clicked", () => {
    const onClose = vi.fn();
    render(<AboutModal isOpen={true} onClose={onClose} />);

    const closeButton = screen.getByText("Close");
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should display copyright information", () => {
    const onClose = vi.fn();
    render(<AboutModal isOpen={true} onClose={onClose} />);
    expect(
      screen.getByText(/Copyright © 2024 Quantum Billing, LLC/i)
    ).toBeInTheDocument();
  });
});
