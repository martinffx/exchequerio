import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { VerifyEmailForm } from "./VerifyEmailForm";

// Helper to render component with router context
function renderWithRouter(ui: React.ReactElement) {
	const router = createMemoryRouter(
		[
			{
				path: "/",
				element: ui,
				action: async () => ({ success: true }), // Mock action to prevent 405 error
			},
		],
		{
			initialEntries: ["/"],
		}
	);

	return render(<RouterProvider router={router} />);
}

describe("VerifyEmailForm", () => {
	it("should render form with email display", () => {
		renderWithRouter(<VerifyEmailForm email="test@example.com" />);

		expect(screen.getByText(/verify your email/i)).toBeInTheDocument();
		expect(screen.getByText(/test@example.com/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /verify/i })).toBeInTheDocument();
	});

	it("should render CodeInput component", () => {
		renderWithRouter(<VerifyEmailForm email="test@example.com" />);

		// CodeInput renders 6 individual inputs
		const inputs = screen.getAllByRole("textbox");
		expect(inputs).toHaveLength(6);
	});

	it("should display error message when provided", () => {
		renderWithRouter(<VerifyEmailForm email="test@example.com" error="Invalid code" />);

		expect(screen.getByText("Invalid code")).toBeInTheDocument();
		expect(screen.getByRole("alert")).toBeInTheDocument();
	});

	it("should populate hidden code input when digits are entered", async () => {
		const user = userEvent.setup();
		renderWithRouter(<VerifyEmailForm email="test@example.com" />);

		const inputs = screen.getAllByRole("textbox");

		// Type 6 digits
		await user.type(inputs[0], "1");
		await user.type(inputs[1], "2");
		await user.type(inputs[2], "3");
		await user.type(inputs[3], "4");
		await user.type(inputs[4], "5");
		await user.type(inputs[5], "6");

		// Hidden input should contain the full code
		await waitFor(() => {
			const hiddenInput = document.querySelector('input[name="code"]') as HTMLInputElement;
			expect(hiddenInput?.value).toBe("123456");
		});
	});

	it("should include hidden email input", () => {
		renderWithRouter(<VerifyEmailForm email="test@example.com" />);

		const emailInput = document.querySelector('input[name="email"]') as HTMLInputElement;
		expect(emailInput).toBeInTheDocument();
		expect(emailInput?.value).toBe("test@example.com");
		expect(emailInput?.type).toBe("hidden");
	});

	it("should have resend code button that starts cooldown when clicked", async () => {
		const user = userEvent.setup();
		renderWithRouter(<VerifyEmailForm email="test@example.com" />);

		const resendButton = screen.getByRole("button", { name: /resend code/i });
		expect(resendButton).toBeEnabled();

		// Click resend button
		await user.click(resendButton);

		// Button should be disabled with countdown
		await waitFor(() => {
			expect(resendButton).toBeDisabled();
			expect(resendButton).toHaveTextContent(/resend code in \d+s/i);
		});
	});

	it("should render without email (optional prop)", () => {
		renderWithRouter(<VerifyEmailForm />);

		expect(screen.getByText(/verify your email/i)).toBeInTheDocument();
		expect(screen.queryByText(/@/)).not.toBeInTheDocument();
	});
});
