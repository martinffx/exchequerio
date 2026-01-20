import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { LoginForm } from "./LoginForm";

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

describe("LoginForm", () => {
	it("should render login form with email and password fields", () => {
		renderWithRouter(<LoginForm />);

		expect(screen.getByLabelText("Email")).toBeInTheDocument();
		expect(screen.getByLabelText("Password")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
	});

	it("should render error message when provided", () => {
		const errorMessage = "Invalid credentials";
		renderWithRouter(<LoginForm error={errorMessage} />);

		expect(screen.getByText(errorMessage)).toBeInTheDocument();
		expect(screen.getByRole("alert")).toBeInTheDocument();
	});

	it("should not render error alert when no error provided", () => {
		renderWithRouter(<LoginForm />);

		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("should render link to forgot password page", () => {
		renderWithRouter(<LoginForm />);

		const forgotPasswordLink = screen.getByRole("link", { name: /forgot password/i });
		expect(forgotPasswordLink).toBeInTheDocument();
		expect(forgotPasswordLink).toHaveAttribute("href", "/forgot-password");
	});

	it("should render link to signup page", () => {
		renderWithRouter(<LoginForm />);

		const signupLink = screen.getByRole("link", { name: /sign up/i });
		expect(signupLink).toBeInTheDocument();
		expect(signupLink).toHaveAttribute("href", "/signup");
	});

	it("should have required attribute on email and password fields", () => {
		renderWithRouter(<LoginForm />);

		expect(screen.getByLabelText("Email")).toBeRequired();
		expect(screen.getByLabelText("Password")).toBeRequired();
	});

	it("should use PasswordInput component for password field", () => {
		renderWithRouter(<LoginForm />);

		// PasswordInput should have a toggle button
		expect(screen.getByRole("button", { name: /show password/i })).toBeInTheDocument();
	});
});
