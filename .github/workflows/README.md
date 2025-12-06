# GitHub Actions Workflows

## Publish to npm

The `publish.yml` workflow handles publishing the movehat package to npm.

### How it works

1. **Automatically replaces `workspace:*` with the actual version** in the template's `package.json`
2. Builds the package
3. Publishes to npm
4. Creates a git tag (if triggered manually)

### Triggering the workflow

#### Option 1: Create a GitHub Release (Recommended)

1. Go to GitHub > Releases > Create a new release
2. Create a new tag (e.g., `v0.0.1`)
3. Publish the release
4. The workflow will automatically publish to npm

#### Option 2: Manual Trigger

1. Go to Actions > Publish to npm > Run workflow
2. Enter the version number (e.g., `0.0.1`)
3. The workflow will publish and create a git tag

### Prerequisites

Before publishing, make sure:

1. **NPM_TOKEN secret is set** in GitHub repository settings:
   - Go to Settings > Secrets and variables > Actions
   - Create a new secret named `NPM_TOKEN`
   - Get your npm token from https://www.npmjs.com/settings/YOUR_USERNAME/tokens

2. **You're logged into npm** with publish access to the package

### Development vs Production

- **Development**: Template uses `"movehat": "workspace:*"`
- **Production**: GitHub Action replaces it with `"movehat": "^X.X.X"`

This allows us to:
- Test locally using the workspace version
- Publish with the correct version automatically
- No manual find-replace needed
