# Contributing to aster-ho

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/AsterZephyr/aster-ho.git
cd aster-ho

# Install dependencies
pnpm install

# Build all packages
pnpm turbo build

# Run all tests
pnpm turbo test
```

## Project Structure

This is a monorepo managed with pnpm workspaces and Turborepo. Each package lives under `packages/` with its own `package.json`, build config, and tests.

## Making Changes

1. Create a feature branch from `main`
2. Make your changes following the coding conventions below
3. Add or update tests (minimum 80% coverage)
4. Run `pnpm turbo build && pnpm turbo test` to verify
5. Submit a Pull Request

## Coding Conventions

- **TypeScript** — strict mode, no `any` unless absolutely necessary
- **Immutability** — use `readonly`, spread for updates, never mutate
- **File size** — 200-400 lines typical, 800 max
- **Tests** — vitest, at least 5 tests per package
- **Exports** — CJS + ESM + DTS via tsup
- **Dependencies** — minimal; prefer peer deps for optional integrations

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new enricher for X
fix: correct baseline z-score calculation
refactor: extract shared types to SDK
docs: update README architecture diagram
test: add edge case tests for context-rot
```

## Package Naming

- Public npm scope: `@ho/*`
- Enrichers: `@ho/enricher-<name>`
- Exporters: `@ho/exporter-<name>`
- Receivers: `@ho/receiver-<name>`
- Instrumentations: `@ho/instrumentation-<name>`

## Running Individual Packages

```bash
# Build a specific package
pnpm --filter @ho/sdk build

# Test a specific package
pnpm --filter @ho/baseline test

# Run CLI locally
node packages/cli/dist/index.js validate --config ho.config.yaml
```

## Reporting Issues

Use GitHub Issues with the appropriate label:
- `bug` — something is broken
- `feature` — new capability request
- `docs` — documentation improvement
- `question` — usage question

## Code of Conduct

Be respectful. We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
