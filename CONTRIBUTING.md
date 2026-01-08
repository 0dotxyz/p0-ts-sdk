# Contributing to P0 TypeScript SDK

Thank you for your interest in contributing to the P0 TypeScript SDK! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm or pnpm (pnpm recommended)
- Git

### Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/p0-ts-sdk.git
   cd p0-ts-sdk
   ```

3. Install dependencies:
   ```bash
   npm install
   # or
   pnpm install
   ```

4. Build the project:
   ```bash
   npm run build
   ```

5. Run tests:
   ```bash
   npm test
   ```

## Development Workflow

### Branch Naming

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions or changes

Example: `feature/add-flashloan-support`

### Making Changes

1. Create a new branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes following our code standards (see below)

3. Write or update tests for your changes

4. Run the test suite:
   ```bash
   npm test
   ```

5. Run linting and formatting:
   ```bash
   npm run lint
   npm run format
   ```

6. Commit your changes with a clear message:
   ```bash
   git commit -m "feat: add flashloan support"
   ```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Test additions or changes
- `chore:` - Build process or auxiliary tool changes

Examples:
```
feat: add support for flashloans
fix: resolve race condition in oracle updates
docs: update README with new examples
refactor: simplify bank fetching logic
test: add unit tests for MarginfiAccount
```

### Pull Requests

1. Push your branch to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

2. Open a pull request against the `main` branch

3. Fill out the PR template with:
   - Description of changes
   - Related issues
   - Testing done
   - Screenshots (if UI changes)

4. Wait for review and address feedback

## Code Standards

### TypeScript

- Use TypeScript strict mode
- Add proper type annotations
- Avoid `any` types when possible
- Use JSDoc comments for public APIs

### Style Guide

We use ESLint and Prettier for code formatting:

```typescript
// Good
export async function fetchAccount(
  address: PublicKey,
  program: Program
): Promise<MarginfiAccount> {
  // Implementation
}

// Bad
export async function fetchAccount(address, program) {
  // Implementation
}
```

### Documentation

- Add JSDoc comments to all public functions and classes
- Include examples in documentation
- Update README.md if adding new features
- Add entries to CHANGELOG.md

Example:
```typescript
/**
 * Fetches a marginfi account from the blockchain
 * @param address - The public key of the account
 * @param program - The Anchor program instance
 * @returns The fetched MarginfiAccount
 * @throws {Error} If the account does not exist
 * @example
 * ```typescript
 * const account = await fetchAccount(accountPubkey, program);
 * ```
 */
export async function fetchAccount(
  address: PublicKey,
  program: Program
): Promise<MarginfiAccount> {
  // Implementation
}
```

## Testing

### Writing Tests

- Write tests for all new features
- Update tests when changing functionality
- Use descriptive test names
- Group related tests with `describe` blocks

Example:
```typescript
describe("MarginfiAccount", () => {
  describe("deposit", () => {
    it("should deposit tokens successfully", async () => {
      // Test implementation
    });

    it("should throw error for invalid amount", async () => {
      // Test implementation
    });
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test src/models/account.test.ts
```

## Project Structure

```
p0-ts-sdk/
├── src/
│   ├── index.ts           # Main entry point
│   ├── config/            # Configuration
│   ├── models/            # Core models
│   ├── services/          # Business logic
│   ├── types/             # Type definitions
│   ├── utils/             # Utilities
│   ├── errors/            # Error definitions
│   ├── idl/               # Anchor IDL files
│   └── vendor/            # Third-party integrations
├── tests/                 # Test files
├── examples/              # Usage examples
└── docs/                  # Documentation
```

## Release Process

Releases are handled by maintainers:

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create a git tag
4. Push tag to trigger CI/CD
5. CI automatically publishes to npm

## Questions?

- Open an issue for bug reports or feature requests
- Join our Discord for discussions
- Email: support@p0protocol.com

## Code of Conduct

Be respectful and constructive. We're all here to build great software together.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
