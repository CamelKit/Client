#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const clientPkgPath = resolve(rootDir, 'packages/client/package.json');

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: rootDir, stdio: 'inherit', ...opts });
}

function runOutput(cmd) {
  return execSync(cmd, { cwd: rootDir, encoding: 'utf8' }).trim();
}

const args = process.argv.slice(2);
const isHelp = args.some((a) => ['-h', '--help', 'help'].includes(a));
const isBumpOnly = args.some((a) => ['--bump-only', '--no-commit'].includes(a));
const isNoTag = args.some((a) => a === '--no-tag');
const isForce = args.some((a) => a === '--force');

const bumpType = args.find((a) => !a.startsWith('-')) || 'patch';

if (isHelp) {
  console.log(`
Usage:
  pnpm release:client [patch | minor | major | <explicit-version>] [--no-tag] [--force]
  pnpm bump:client [patch | minor | major | <explicit-version>]

Options:
  --bump-only, --no-commit  Only update packages/client/package.json without committing or tagging
  --no-tag                  Commit the version bump but do not create a git tag
  --force                   Allow cutting a stable release tag from a non-main branch

Examples:
  pnpm bump:client patch        # Update package.json: 0.0.1 -> 0.0.2 (no commit/tag)
  pnpm bump:client minor        # Update package.json: 0.0.1 -> 0.1.0
  pnpm release:client patch     # Bumps to 0.0.2, commits and tags v0.0.2 (must be on main or use --force)
  pnpm release:client 0.1.0     # Bumps to 0.1.0, commits and tags v0.1.0
`);
  process.exit(0);
}

const pkgRaw = readFileSync(clientPkgPath, 'utf8');
const pkg = JSON.parse(pkgRaw);
const currentVersion = pkg.version;

function bumpVersion(version, type) {
  const cleanVersion = version.replace(/-.*$/, '');
  const parts = cleanVersion.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Current version "${version}" is not valid semver (X.Y.Z)`);
  }

  if (type === 'patch') {
    parts[2] += 1;
    return parts.join('.');
  } else if (type === 'minor') {
    parts[1] += 1;
    parts[2] = 0;
    return parts.join('.');
  } else if (type === 'major') {
    parts[0] += 1;
    parts[1] = 0;
    parts[2] = 0;
    return parts.join('.');
  } else if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(type)) {
    return type;
  } else {
    throw new Error(`Unknown bump type or invalid version: "${type}". Use patch, minor, major, or X.Y.Z.`);
  }
}

const nextVersion = bumpVersion(currentVersion, bumpType);
const tagName = `v${nextVersion}`;
const isPrerelease = nextVersion.includes('-');
const currentBranch = runOutput('git rev-parse --abbrev-ref HEAD') || 'dev';

// Guard: Prevent cutting stable release tags from non-main branches (e.g. dev)
if (!isBumpOnly && !isNoTag && !isPrerelease && currentBranch !== 'main' && !isForce) {
  console.error(`
❌ Error: Cannot cut a stable release tag (${tagName}) from branch '${currentBranch}'.
Stable releases without a pre-release suffix (e.g. vX.Y.Z) must only be released from 'main'.

Available alternatives:
  1. Bump package.json on dev without tagging (pushing to dev auto-builds beta pre-releases):
     pnpm bump:client ${bumpType}
  2. Commit the bump without creating a git tag:
     pnpm release:client ${bumpType} --no-tag
  3. Release an explicit pre-release tag:
     pnpm release:client ${nextVersion}-beta.1
  4. Force release tag on '${currentBranch}':
     pnpm release:client ${bumpType} --force
`);
  process.exit(1);
}

console.log(`\n📦 Bumping CamelKit Client version: ${currentVersion} -> ${nextVersion}`);

if (!isBumpOnly) {
  // 1. Run quality guards
  console.log('🛡️  Running anti-bot guard...');
  run('node scripts/guard-input-fabrication.mjs');
}

// 2. Update packages/client/package.json
pkg.version = nextVersion;
writeFileSync(clientPkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`📝 Updated ${clientPkgPath} to version ${nextVersion}`);

if (isBumpOnly) {
  console.log(`\n✅ Version bumped in package.json to ${nextVersion}. (Commit and tag skipped via --bump-only)\n`);
  process.exit(0);
}

// 3. Git commit & tag
try {
  run(`git add "${clientPkgPath}"`);
  run(`git commit -m "chore(client): release v${nextVersion}"`);
  if (!isNoTag) {
    run(`git tag -a "${tagName}" -m "Release CamelKit v${nextVersion}"`);
  }
} catch (err) {
  console.error('❌ Failed to commit or tag:', err);
  process.exit(1);
}

console.log(`
✅ Release commit ${isNoTag ? '' : 'and tag ' + tagName} created successfully!

To trigger builds and releases in GitHub Actions, push to GitHub:
  git push origin ${currentBranch}
${isNoTag ? '' : `  git push origin ${tagName}`}
`);
