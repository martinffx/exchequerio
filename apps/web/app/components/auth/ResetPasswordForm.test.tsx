import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { ResetPasswordForm } from "./ResetPasswordForm";

// Helper to render component with router context
function renderWithRouter(ui: React.ReactElement) {
	const router = createMemoryRouter(
		[
			{
				path: "/",
				element: ui,
			},
		],
		{
			initialEntries: ["/"],
		}
	);

	return render(<RouterProvider router={router} />);
}

describe("ResetPasswordForm", () => {
	it("renders form with password fields", () => {
		renderWithRouter(<ResetPasswordForm token="test-token" />);

		expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
	});

	it("renders hidden token field with correct value", () => {
		renderWithRouter(<ResetPasswordForm token="test-token-123" />);

		const tokenInput = screen.getByDisplayValue("test-token-123");
		expect(tokenInput).toBeInTheDocument();
		expect(tokenInput).toHaveAttribute("type", "hidden");
		expect(tokenInput).toHaveAttribute("name", "token");
	});

	it("renders submit button", () => {
		renderWithRouter(<ResetPasswordForm token="test-token" />);

		const submitButton = screen.getByRole("button", { name: /reset password/i });
		expect(submitButton).toBeInTheDocument();
		expect(submitButton).toHaveAttribute("type", "submit");
	});

	it("displays error message when provided", () => {
		const errorMessage = "Invalid or expired reset token";
		renderWithRouter(<ResetPasswordForm token="test-token" error={errorMessage} />);

		expect(screen.getByText(errorMessage)).toBeInTheDocument();
	});

	it("does not display error message when not provided", () => {
		renderWithRouter(<ResetPasswordForm token="test-token" />);

		const alerts = screen.queryByRole("alert");
		expect(alerts).not.toBeInTheDocument();
	});

	it("renders card with title and description", () => {
		renderWithRouter(<ResetPasswordForm token="test-token" />);

		// Check for title in card header (not the button)
		expect(screen.getByText(/enter your new password below/i)).toBeInTheDocument();
	});

	it("renders link back to login", () => {
		renderWithRouter(<ResetPasswordForm token="test-token" />);

		const loginLink = screen.getByRole("link", { name: /back to login/i });
		expect(loginLink).toBeInTheDocument();
		expect(loginLink).toHaveAttribute("href", "/login");
	});
});
