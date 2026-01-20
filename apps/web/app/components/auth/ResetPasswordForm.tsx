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
import { Label } from "@/components/ui/label";
import { PasswordInput } from "./PasswordInput";

type ResetPasswordFormProps = {
	token: string | null;
	error?: string;
};

export function ResetPasswordForm({ token, error }: ResetPasswordFormProps) {
	return (
		<div className="flex min-h-screen items-center justify-center">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>Reset Password</CardTitle>
					<CardDescription>Enter your new password below</CardDescription>
				</CardHeader>
				<CardContent>
					{error && (
						<Alert variant="destructive" className="mb-4">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					)}
					<Form method="post" className="space-y-4">
						<input type="hidden" name="token" value={token || ""} />
						<div className="space-y-2">
							<Label htmlFor="password">Password</Label>
							<PasswordInput id="password" name="password" required />
						</div>
						<div className="space-y-2">
							<Label htmlFor="confirmPassword">Confirm Password</Label>
							<PasswordInput id="confirmPassword" name="confirmPassword" required />
						</div>
						<Button type="submit" className="w-full">
							Reset Password
						</Button>
					</Form>
				</CardContent>
				<CardFooter className="flex justify-center">
					<p className="text-sm text-muted-foreground">
						<Link to="/login" className="text-primary hover:underline">
							Back to login
						</Link>
					</p>
				</CardFooter>
			</Card>
		</div>
	);
}
