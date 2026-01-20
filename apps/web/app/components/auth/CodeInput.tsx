import { useRef, useState } from "react";

import { Input } from "@/components/ui/input";

type CodeInputProps = {
	name: string;
	length?: number;
	onComplete?: (code: string) => void;
};

export function CodeInput({ name, length = 6, onComplete }: CodeInputProps) {
	const [values, setValues] = useState<string[]>(Array(length).fill(""));
	const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

	const handleChange = (index: number, value: string) => {
		// Only allow digits
		if (!/^\d*$/.test(value)) return;

		const newValues = [...values];
		newValues[index] = value.slice(-1); // Only take last character
		setValues(newValues);

		// Auto-advance to next input
		if (value && index < length - 1) {
			inputRefs.current[index + 1]?.focus();
		}

		// Check if complete
		if (newValues.every(v => v) && onComplete) {
			onComplete(newValues.join(""));
		}
	};

	const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
		if (e.key === "Backspace" && !values[index] && index > 0) {
			inputRefs.current[index - 1]?.focus();
		}
	};

	const handlePaste = (e: React.ClipboardEvent) => {
		e.preventDefault();
		const pastedData = e.clipboardData.getData("text").slice(0, length);

		if (!/^\d+$/.test(pastedData)) return;

		const newValues = pastedData.split("");
		setValues([...newValues, ...Array(length - newValues.length).fill("")]);

		if (newValues.length === length && onComplete) {
			onComplete(newValues.join(""));
		}
	};

	return (
		<div className="flex gap-2">
			<input type="hidden" name={name} value={values.join("")} />
			{values.map((value, index) => {
				const inputId = `${name}-${index}`;
				return (
					<Input
						key={inputId}
						ref={el => {
							inputRefs.current[index] = el;
						}}
						type="text"
						inputMode="numeric"
						maxLength={1}
						value={value}
						onChange={e => handleChange(index, e.target.value)}
						onKeyDown={e => handleKeyDown(index, e)}
						onPaste={handlePaste}
						className="w-12 text-center"
					/>
				);
			})}
		</div>
	);
}
