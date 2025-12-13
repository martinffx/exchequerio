import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Heading from "@theme/Heading";
import Layout from "@theme/Layout";

export default function Home(): JSX.Element {
	const { siteConfig } = useDocusaurusContext();
	return (
		<Layout title={`Hello from ${siteConfig.title}`} description="Modern double-entry ledger API">
			<main className="container margin-vert--xl">
				<div className="text--center">
					<Heading as="h1">{siteConfig.title}</Heading>
					<p className="hero__subtitle">{siteConfig.tagline}</p>
				</div>
			</main>
		</Layout>
	);
}
