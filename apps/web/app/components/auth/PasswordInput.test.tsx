import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PasswordInput } from "./PasswordInput";

describe("PasswordInput", () => {
	it("should render input with type password by default", () => {
		const { container } = render(<PasswordInput id="password" name="password" />);

		const input = container.querySelector('input[type="password"]') as HTMLInputElement;
		expect(input).toBeInTheDocument();
		expect(input).toHaveAttribute("id", "password");
		expect(input).toHaveAttribute("name", "password");
	});

	it("should render toggle button with Eye icon", () => {
		render(<PasswordInput id="password" name="password" />);

		const toggleButton = screen.getByRole("button", { name: /show password/i });
		expect(toggleButton).toBeInTheDocument();
	});

	it("should toggle password visibility when button clicked", async () => {
		const user = userEvent.setup();
		const { container } = render(<PasswordInput id="password" name="password" />);

		const input = container.querySelector("input") as HTMLInputElement;
		const toggleButton = screen.getByRole("button", { name: /show password/i });

		// Initially password type
		expect(input).toHaveAttribute("type", "password");

		// Click to show password
		await user.click(toggleButton);
		expect(input).toHaveAttribute("type", "text");
		expect(screen.getByRole("button", { name: /hide password/i })).toBeInTheDocument();

		// Click to hide password again
		await user.click(toggleButton);
		expect(input).toHaveAttribute("type", "password");
		expect(screen.getByRole("button", { name: /show password/i })).toBeInTheDocument();
	});

	it("should pass required prop to input", () => {
		const { container } = render(<PasswordInput id="password" name="password" required />);

		const input = container.querySelector("input") as HTMLInputElement;
		expect(input).toBeRequired();
	});

	it("should have accessible aria-label on toggle button", () => {
		render(<PasswordInput id="password" name="password" />);

		const toggleButton = screen.getByRole("button", { name: /show password/i });
		expect(toggleButton).toHaveAttribute("aria-label", "Show password");
	});
});
