import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PasswordInputProps = {
	id: string;
	name: string;
	required?: boolean;
};

export function PasswordInput({ id, name, required }: PasswordInputProps) {
	const [showPassword, setShowPassword] = useState(false);

	return (
		<div className="relative">
			<Input id={id} name={name} type={showPassword ? "text" : "password"} required={required} />
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="absolute right-0 top-0 h-full"
				onClick={() => setShowPassword(!showPassword)}
				aria-label={showPassword ? "Hide password" : "Show password"}
			>
				{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
			</Button>
		</div>
	);
}
