import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { MagicLinkForm } from "./MagicLinkForm";

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
		},
	);

	return render(<RouterProvider router={router} />);
}

describe("MagicLinkForm", () => {
	it("renders step 1 (email input) when codeSent is false", () => {
		renderWithRouter(<MagicLinkForm codeSent={false} />);

		expect(screen.getByText("Magic Link")).toBeInTheDocument();
		expect(
			screen.getByText("Sign in with a magic link sent to your email"),
		).toBeInTheDocument();
	});

	it("renders step 2 (code input) when codeSent is true", () => {
		renderWithRouter(<MagicLinkForm codeSent={true} />);

		expect(screen.getByText("Magic Link")).toBeInTheDocument();
		expect(
			screen.getByText("Enter the code sent to your email"),
		).toBeInTheDocument();
	});

	it("displays email input field in step 1", () => {
		renderWithRouter(<MagicLinkForm codeSent={false} />);

		const emailInput = screen.getByLabelText("Email");
		expect(emailInput).toBeInTheDocument();
		expect(emailInput).toHaveAttribute("type", "email");
		expect(emailInput).toHaveAttribute("name", "email");
		expect(emailInput).toBeRequired();
	});

	it("displays CodeInput component in step 2", () => {
		renderWithRouter(<MagicLinkForm codeSent={true} />);

		expect(screen.getByText("Verification Code")).toBeInTheDocument();
		// CodeInput renders 6 individual inputs
		const codeInputs = screen.getAllByRole("textbox");
		expect(codeInputs).toHaveLength(6);
	});

	it("displays error message when provided", () => {
		const errorMessage = "Invalid code";
		renderWithRouter(<MagicLinkForm error={errorMessage} />);

		expect(screen.getByText(errorMessage)).toBeInTheDocument();
	});

	it('shows "Send Code" button in step 1', () => {
		renderWithRouter(<MagicLinkForm codeSent={false} />);

		const submitButton = screen.getByRole("button", { name: "Send Code" });
		expect(submitButton).toBeInTheDocument();
		expect(submitButton).toHaveAttribute("type", "submit");
	});

	it('shows "Verify Code" button in step 2', () => {
		renderWithRouter(<MagicLinkForm codeSent={true} />);

		const submitButton = screen.getByRole("button", { name: "Verify Code" });
		expect(submitButton).toBeInTheDocument();
		expect(submitButton).toHaveAttribute("type", "submit");
	});

	it("links to login page", () => {
		renderWithRouter(<MagicLinkForm />);

		const loginLink = screen.getByRole("link", { name: "Sign in" });
		expect(loginLink).toBeInTheDocument();
		expect(loginLink).toHaveAttribute("href", "/login");
	});
});
