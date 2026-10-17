#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const corePkgPath = resolve(rootDir, 'packages/core/package.json');

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: rootDir, stdio: 'inherit', ...opts });
}

function runOutput(cmd) {
  return execSync(cmd, { cwd: rootDir, encoding: 'utf8' }).trim();
}

const arg = process.argv[2] || 'patch';

if (['-h', '--help', 'help'].includes(arg)) {
  console.log(`
Usage: pnpm release:core [patch | minor | major | <explicit-version>]

Examples:
  pnpm release:core patch       # 0.1.2 -> 0.1.3
  pnpm release:core minor       # 0.1.2 -> 0.2.0
  pnpm release:core major       # 0.1.2 -> 1.0.0
  pnpm release:core 0.2.0-rc.1  # Set explicit version
`);
  process.exit(0);
}

const pkgRaw = readFileSync(corePkgPath, 'utf8');
const pkg = JSON.parse(pkgRaw);
const currentVersion = pkg.version;

function bumpVersion(version, type) {
  const parts = version.split('.').map((p) => parseInt(p, 10));
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

const nextVersion = bumpVersion(currentVersion, arg);
const tagName = `core-v${nextVersion}`;

console.log(`\n📦 Preparing @camelkit/core release: ${currentVersion} -> ${nextVersion} (Tag: ${tagName})\n`);

// 1. Run quality guards
console.log('🛡️  Running anti-bot guard...');
run('node scripts/guard-input-fabrication.mjs');

// 2. Build core to ensure types and bundle compile cleanly
console.log('🔨 Building @camelkit/core...');
run('pnpm --filter @camelkit/core build');

// 3. Update package.json
pkg.version = nextVersion;
writeFileSync(corePkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`📝 Updated ${corePkgPath} to version ${nextVersion}`);

// 4. Git commit & tag
const currentBranch = runOutput('git rev-parse --abbrev-ref HEAD') || 'dev';

try {
  run(`git add "${corePkgPath}"`);
  run(`git commit -m "chore(core): release @camelkit/core@${nextVersion}"`);
  run(`git tag -a "${tagName}" -m "Release @camelkit/core v${nextVersion}"`);
} catch (err) {
  console.error('❌ Failed to commit or tag:', err);
  process.exit(1);
}

console.log(`
✅ Release commit and tag created successfully!

To trigger the automated GitHub Actions publishing pipeline to NPM, push to GitHub:
  git push origin ${currentBranch}
  git push origin ${tagName}
`);
