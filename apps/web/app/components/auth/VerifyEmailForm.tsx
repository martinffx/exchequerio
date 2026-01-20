import { useEffect, useRef, useState } from "react";
import { Form } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

import { CodeInput } from "./CodeInput";

type VerifyEmailFormProps = {
	email?: string;
	error?: string;
};

export function VerifyEmailForm({ email, error }: VerifyEmailFormProps) {
	const [cooldown, setCooldown] = useState(0);
	const formRef = useRef<HTMLFormElement>(null);

	// Countdown timer for resend button
	useEffect(() => {
		if (cooldown > 0) {
			const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
			return () => clearTimeout(timer);
		}
	}, [cooldown]);

	const handleResendCode = () => {
		// TODO: Implement resend code logic
		setCooldown(60);
	};

	const handleCodeComplete = () => {
		// Auto-submit form when code is complete
		formRef.current?.requestSubmit();
	};

	return (
		<Card className="w-full max-w-md mx-auto">
			<CardHeader>
				<CardTitle>Verify Your Email</CardTitle>
				<CardDescription>
					{email ? (
						<>
							We sent a verification code to <strong>{email}</strong>
						</>
					) : (
						"Enter the verification code sent to your email"
					)}
				</CardDescription>
			</CardHeader>

			<Form method="post" ref={formRef}>
				<CardContent className="space-y-4">
					{error && (
						<Alert variant="destructive">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					)}

					{email && <input type="hidden" name="email" value={email} />}

					<div className="space-y-2">
						<label htmlFor="code" className="text-sm font-medium">
							Verification Code
						</label>
						<CodeInput name="code" onComplete={handleCodeComplete} />
					</div>
				</CardContent>

				<CardFooter className="flex flex-col gap-2">
					<Button type="submit" className="w-full">
						Verify
					</Button>

					<Button
						type="button"
						variant="ghost"
						className="w-full"
						onClick={handleResendCode}
						disabled={cooldown > 0}
					>
						{cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
					</Button>
				</CardFooter>
			</Form>
		</Card>
	);
}
