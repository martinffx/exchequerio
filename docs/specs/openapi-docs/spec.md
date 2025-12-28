# OpenAPI Docs Specification

## User Story

As a developer, I want to see the OpenAPI specification in the docs website, so that I can easily access comprehensive API documentation

## Acceptance Criteria

1. GIVEN the docs site is running, WHEN I navigate to the API section, THEN I should see auto-generated API documentation from the OpenAPI spec
2. GIVEN the API server is running on localhost:3000, WHEN the docs site builds, THEN it should fetch the latest OpenAPI spec from /docs/json endpoint
3. GIVEN the OpenAPI spec is fetched, WHEN generating docs, THEN the documentation should integrate with the existing Docusaurus sidebar and theme
4. GIVEN changes are made to the API, WHEN the docs rebuild, THEN the API documentation should reflect the latest spec without manual updates

## Business Rules

- OpenAPI spec file must be sourced from @apps/api/ endpoint (http://localhost:3000/docs/json)
- Documentation must auto-generate from spec (no manual sync required)
- OpenAPI docs must integrate with existing Docusaurus navigation/theme
- Generated docs should update when spec changes (during build)
- Must support standard OpenAPI 3.1.x specification format

## Scope

### Included
- Install and configure docusaurus-openapi-docs plugin
- Fetch OpenAPI spec from @apps/api/ endpoint
- Auto-generate API reference documentation pages
- Integrate generated docs into Docusaurus sidebar navigation
- Apply existing Docusaurus theme to API docs
- Build-time spec fetching and documentation generation

### Excluded
- Multiple API versions/environments (can add later)
- Custom OpenAPI spec editor or validator UI
- Live API testing with real authentication tokens
- Manual API documentation (everything auto-generated)
- Versioned API documentation history

## Dependencies

- API server must be running during docs build (or spec must be saved to file)
- docusaurus-openapi-docs plugin and dependencies
- Existing Docusaurus 3 setup
- OpenAPI 3.0.0 spec from Fastify @fastify/swagger

## Diagrams

<!-- Add sequence diagrams, entity relationship diagrams, or flow diagrams here if needed -->

## Technical Details

### Plugin
- Name: docusaurus-openapi-docs
- Source: https://github.com/PaloAltoNetworks/docusaurus-openapi-docs
- Package: docusaurus-plugin-openapi-docs

### API Spec
- Framework: Fastify
- Spec Generator: @fastify/swagger
- Spec Version: OpenAPI 3.0.0
- Runtime Endpoint: http://localhost:3000/docs/json

### Documentation Framework
- Name: Docusaurus
- Version: 3.x
- Preset: Classic
- Config File: apps/docs/docusaurus.config.ts

### Integration Approach
- Fetch Method: HTTP request to running API server during build
- Fallback: Consider saving spec to static file for CI/CD
- Sidebar Integration: Auto-generate sidebar items from OpenAPI paths
- Theme Consistency: Use docusaurus-theme-openapi-docs for consistent styling

## Alignment

This feature aligns with supporting the product vision of making the Ledger API accessible and well-documented for Financial Operations teams at PSPs and Marketplaces