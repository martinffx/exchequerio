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
import { PasswordInput } from "./PasswordInput";

type SignupFormProps = {
	error?: string;
};

export function SignupForm({ error }: SignupFormProps) {
	return (
		<div className="flex min-h-screen items-center justify-center">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>Create Account</CardTitle>
					<CardDescription>Sign up to get started with your account</CardDescription>
				</CardHeader>
				<CardContent>
					{error && (
						<Alert variant="destructive" className="mb-4">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					)}
					<Form method="post" className="space-y-4">
						<div className="grid grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="firstName">First Name</Label>
								<Input id="firstName" name="firstName" type="text" placeholder="John" required />
							</div>
							<div className="space-y-2">
								<Label htmlFor="lastName">Last Name</Label>
								<Input id="lastName" name="lastName" type="text" placeholder="Doe" required />
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor="email">Email</Label>
							<Input id="email" name="email" type="email" placeholder="you@example.com" required />
						</div>
						<div className="space-y-2">
							<Label htmlFor="password">Password</Label>
							<PasswordInput id="password" name="password" required />
						</div>
						<div className="space-y-2">
							<Label htmlFor="confirmPassword">Confirm Password</Label>
							<PasswordInput id="confirmPassword" name="confirmPassword" required />
						</div>
						<Button type="submit" className="w-full">
							Create Account
						</Button>
					</Form>
				</CardContent>
				<CardFooter className="flex justify-center">
					<p className="text-sm text-muted-foreground">
						Already have an account?{" "}
						<Link to="/login" className="text-primary hover:underline">
							Sign in
						</Link>
					</p>
				</CardFooter>
			</Card>
		</div>
	);
}
