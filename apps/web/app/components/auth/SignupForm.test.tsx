import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { SignupForm } from "./SignupForm";

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

describe("SignupForm", () => {
	it("should render signup form with email, password, and confirm password fields", () => {
		renderWithRouter(<SignupForm />);

		expect(screen.getByLabelText("Email")).toBeInTheDocument();
		expect(screen.getByLabelText("Password")).toBeInTheDocument();
		expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
	});

	it("should render error message when provided", () => {
		const errorMessage = "Email already exists";
		renderWithRouter(<SignupForm error={errorMessage} />);

		expect(screen.getByText(errorMessage)).toBeInTheDocument();
		expect(screen.getByRole("alert")).toBeInTheDocument();
	});

	it("should not render error alert when no error provided", () => {
		renderWithRouter(<SignupForm />);

		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("should render link to login page", () => {
		renderWithRouter(<SignupForm />);

		const loginLink = screen.getByRole("link", { name: /sign in/i });
		expect(loginLink).toBeInTheDocument();
		expect(loginLink).toHaveAttribute("href", "/login");
	});

	it("should have required attribute on all fields", () => {
		renderWithRouter(<SignupForm />);

		expect(screen.getByLabelText("Email")).toBeRequired();
		expect(screen.getByLabelText("Password")).toBeRequired();
		expect(screen.getByLabelText("Confirm Password")).toBeRequired();
	});

	it("should use PasswordInput component for password fields", () => {
		renderWithRouter(<SignupForm />);

		// PasswordInput should have toggle buttons for both password fields
		const toggleButtons = screen.getAllByRole("button", { name: /show password/i });
		expect(toggleButtons).toHaveLength(2); // One for password, one for confirm password
	});

	it("should render first name and last name fields", () => {
		renderWithRouter(<SignupForm />);

		expect(screen.getByLabelText("First Name")).toBeInTheDocument();
		expect(screen.getByLabelText("Last Name")).toBeInTheDocument();
	});
});
