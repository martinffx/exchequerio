import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

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

describe("ForgotPasswordForm", () => {
	it("should render forgot password form with email field", () => {
		renderWithRouter(<ForgotPasswordForm />);

		expect(screen.getByLabelText("Email")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /send reset link/i })).toBeInTheDocument();
	});

	it("should render success message when provided", () => {
		const successMessage = "Password reset email sent. Please check your inbox.";
		renderWithRouter(<ForgotPasswordForm success={true} />);

		expect(screen.getByText(successMessage)).toBeInTheDocument();
		expect(screen.getByRole("alert")).toBeInTheDocument();
	});

	it("should render error message when provided", () => {
		const errorMessage = "Rate limit exceeded";
		renderWithRouter(<ForgotPasswordForm error={errorMessage} />);

		expect(screen.getByText(errorMessage)).toBeInTheDocument();
		expect(screen.getByRole("alert")).toBeInTheDocument();
	});

	it("should not render alert when no success or error provided", () => {
		renderWithRouter(<ForgotPasswordForm />);

		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("should render link back to login page", () => {
		renderWithRouter(<ForgotPasswordForm />);

		const loginLink = screen.getByRole("link", { name: /back to login/i });
		expect(loginLink).toBeInTheDocument();
		expect(loginLink).toHaveAttribute("href", "/login");
	});

	it("should have required attribute on email field", () => {
		renderWithRouter(<ForgotPasswordForm />);

		expect(screen.getByLabelText("Email")).toBeRequired();
	});

	it("should have email type on email field", () => {
		renderWithRouter(<ForgotPasswordForm />);

		expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
	});
});
