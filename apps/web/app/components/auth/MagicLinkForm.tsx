import { useRef } from "react";
import { Form, Link } from "react-router";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { CodeInput } from "./CodeInput";

type MagicLinkFormProps = {
	codeSent?: boolean;
	error?: string;
};

/**
 * MagicLinkForm Component
 * Two-step authentication flow:
 * 1. Enter email → send magic link code
 * 2. Enter code → authenticate
 */
export function MagicLinkForm({ codeSent, error }: MagicLinkFormProps) {
	const formRef = useRef<HTMLFormElement>(null);

	const handleCodeComplete = () => {
		// Auto-submit form when code is complete
		formRef.current?.requestSubmit();
	};

	return (
		<Card className="w-full max-w-md mx-auto">
			<CardHeader>
				<CardTitle>Magic Link</CardTitle>
				<CardDescription>
					{codeSent
						? "Enter the code sent to your email"
						: "Sign in with a magic link sent to your email"}
				</CardDescription>
			</CardHeader>

			<Form method="post" ref={formRef}>
				<CardContent className="space-y-4">
					{/* Error message */}
					{error && (
						<Alert variant="destructive">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					)}

					{/* Step 1: Email input */}
					{!codeSent && (
						<div className="space-y-2">
							<Label htmlFor="email">Email</Label>
							<Input
								id="email"
								name="email"
								type="email"
								placeholder="you@example.com"
								required
							/>
						</div>
					)}

					{/* Step 2: Code input */}
					{codeSent && (
						<div className="space-y-2">
							<Label htmlFor="code">Verification Code</Label>
							<CodeInput name="code" onComplete={handleCodeComplete} />
						</div>
					)}
				</CardContent>

				<CardFooter className="flex flex-col gap-2">
					<Button type="submit" className="w-full">
						{codeSent ? "Verify Code" : "Send Code"}
					</Button>

					<p className="text-sm text-center text-muted-foreground">
						Remember your password?{" "}
						<Link to="/login" className="text-primary hover:underline">
							Sign in
						</Link>
					</p>
				</CardFooter>
			</Form>
		</Card>
	);
}
