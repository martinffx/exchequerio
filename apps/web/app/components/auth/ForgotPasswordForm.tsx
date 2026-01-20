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

type ForgotPasswordFormProps = {
	success?: boolean;
	error?: string;
};

export function ForgotPasswordForm({ success, error }: ForgotPasswordFormProps) {
	return (
		<div className="flex min-h-screen items-center justify-center">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>Forgot Password</CardTitle>
					<CardDescription>
						Enter your email address and we'll send you a link to reset your password
					</CardDescription>
				</CardHeader>
				<CardContent>
					{success && (
						<Alert className="mb-4">
							<AlertDescription>
								Password reset email sent. Please check your inbox.
							</AlertDescription>
						</Alert>
					)}
					{error && (
						<Alert variant="destructive" className="mb-4">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					)}
					<Form method="post" className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="email">Email</Label>
							<Input id="email" name="email" type="email" placeholder="you@example.com" required />
						</div>
						<Button type="submit" className="w-full">
							Send Reset Link
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
