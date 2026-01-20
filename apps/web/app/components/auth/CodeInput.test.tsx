import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CodeInput } from "./CodeInput";

describe("CodeInput", () => {
	it("should render 6 individual input fields by default", () => {
		const { container } = render(<CodeInput name="code" />);

		const inputs = container.querySelectorAll('input[type="text"]');
		expect(inputs).toHaveLength(6);
	});

	it("should render custom length of input fields", () => {
		const { container } = render(<CodeInput name="code" length={4} />);

		const inputs = container.querySelectorAll('input[type="text"]');
		expect(inputs).toHaveLength(4);
	});

	it("should have hidden input with full code value", () => {
		const { container } = render(<CodeInput name="code" />);

		const hiddenInput = container.querySelector('input[type="hidden"]') as HTMLInputElement;
		expect(hiddenInput).toBeInTheDocument();
		expect(hiddenInput).toHaveAttribute("name", "code");
		expect(hiddenInput).toHaveValue("");
	});

	it("should auto-advance to next field on input", async () => {
		const user = userEvent.setup();
		const { container } = render(<CodeInput name="code" />);

		const inputs = container.querySelectorAll('input[type="text"]') as NodeListOf<HTMLInputElement>;

		// Type in first input
		await user.type(inputs[0], "1");

		// Should auto-advance to second input
		expect(inputs[1]).toHaveFocus();
	});

	it("should handle backspace to previous field", async () => {
		const user = userEvent.setup();
		const { container } = render(<CodeInput name="code" />);

		const inputs = container.querySelectorAll('input[type="text"]') as NodeListOf<HTMLInputElement>;

		// Type in first two inputs
		await user.type(inputs[0], "1");
		await user.type(inputs[1], "2");

		// Backspace on second input (which is now empty after typing)
		await user.clear(inputs[1]);
		await user.keyboard("{Backspace}");

		// Should move focus to first input
		expect(inputs[0]).toHaveFocus();
	});

	it("should handle paste of 6-digit code", async () => {
		const user = userEvent.setup();
		const { container } = render(<CodeInput name="code" />);

		const inputs = container.querySelectorAll('input[type="text"]') as NodeListOf<HTMLInputElement>;
		const hiddenInput = container.querySelector('input[type="hidden"]') as HTMLInputElement;

		// Paste 6-digit code
		await user.click(inputs[0]);
		await user.paste("123456");

		// All inputs should be filled
		expect(inputs[0]).toHaveValue("1");
		expect(inputs[1]).toHaveValue("2");
		expect(inputs[2]).toHaveValue("3");
		expect(inputs[3]).toHaveValue("4");
		expect(inputs[4]).toHaveValue("5");
		expect(inputs[5]).toHaveValue("6");

		// Hidden input should have full code
		expect(hiddenInput).toHaveValue("123456");
	});

	it("should call onComplete when all digits entered", async () => {
		const user = userEvent.setup();
		const onComplete = vi.fn();
		const { container } = render(<CodeInput name="code" onComplete={onComplete} />);

		const inputs = container.querySelectorAll('input[type="text"]') as NodeListOf<HTMLInputElement>;

		// Type all 6 digits
		await user.type(inputs[0], "1");
		await user.type(inputs[1], "2");
		await user.type(inputs[2], "3");
		await user.type(inputs[3], "4");
		await user.type(inputs[4], "5");
		await user.type(inputs[5], "6");

		// onComplete should be called with full code
		expect(onComplete).toHaveBeenCalledWith("123456");
	});

	it("should only allow numeric input", async () => {
		const user = userEvent.setup();
		const { container } = render(<CodeInput name="code" />);

		const inputs = container.querySelectorAll('input[type="text"]') as NodeListOf<HTMLInputElement>;

		// Try to type non-numeric characters
		await user.type(inputs[0], "abc");

		// Input should remain empty
		expect(inputs[0]).toHaveValue("");
	});

	it("should update hidden input as digits are entered", async () => {
		const user = userEvent.setup();
		const { container } = render(<CodeInput name="code" />);

		const inputs = container.querySelectorAll('input[type="text"]') as NodeListOf<HTMLInputElement>;
		const hiddenInput = container.querySelector('input[type="hidden"]') as HTMLInputElement;

		// Type first 3 digits
		await user.type(inputs[0], "1");
		await user.type(inputs[1], "2");
		await user.type(inputs[2], "3");

		// Hidden input should have partial code
		expect(hiddenInput).toHaveValue("123");
	});

	it("should handle paste of partial code", async () => {
		const user = userEvent.setup();
		const { container } = render(<CodeInput name="code" />);

		const inputs = container.querySelectorAll('input[type="text"]') as NodeListOf<HTMLInputElement>;

		// Paste 3-digit code
		await user.click(inputs[0]);
		await user.paste("123");

		// First 3 inputs should be filled
		expect(inputs[0]).toHaveValue("1");
		expect(inputs[1]).toHaveValue("2");
		expect(inputs[2]).toHaveValue("3");
		expect(inputs[3]).toHaveValue("");
	});

	it("should ignore non-numeric paste", async () => {
		const user = userEvent.setup();
		const { container } = render(<CodeInput name="code" />);

		const inputs = container.querySelectorAll('input[type="text"]') as NodeListOf<HTMLInputElement>;

		// Paste non-numeric text
		await user.click(inputs[0]);
		await user.paste("abc123");

		// All inputs should remain empty
		for (const input of inputs) {
			expect(input).toHaveValue("");
		}
	});

	it("should have inputMode numeric for mobile keyboards", () => {
		const { container } = render(<CodeInput name="code" />);

		const inputs = container.querySelectorAll('input[type="text"]') as NodeListOf<HTMLInputElement>;

		for (const input of inputs) {
			expect(input).toHaveAttribute("inputMode", "numeric");
		}
	});

	it("should have maxLength of 1 for each input", () => {
		const { container } = render(<CodeInput name="code" />);

		const inputs = container.querySelectorAll('input[type="text"]') as NodeListOf<HTMLInputElement>;

		for (const input of inputs) {
			expect(input).toHaveAttribute("maxLength", "1");
		}
	});
});
