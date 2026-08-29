import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Guards scripts/check-version-sync.sh, which .github/workflows/version-sync.yml runs on every
// push and pull request, and .github/workflows/release.yml runs before publishing.
//
// The release workflow step itself can only be exercised by pushing a v* tag, and a tag push in
// this repo publishes to npm immediately and irreversibly (even a failed run signs a permanent
// public provenance statement). So the guard lives in a script and its behaviour is proven here.
//
// Issue #39: main carried 1.1.3 in package.json and 1.1.1 in both of package-lock.json's root
// version fields, through two releases, with nothing to notice.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-version-sync.sh');

interface RunResult {
	status: number;
	stdout: string;
	stderr: string;
}

// Invokes the script directly rather than through `bash`, so a lost executable bit fails here
// rather than at release time.
function run(pkg?: string, lock?: string): RunResult {
	const args: string[] = [];
	if (pkg !== undefined) args.push(pkg);
	if (lock !== undefined) args.push(lock);
	try {
		const stdout = execFileSync(SCRIPT, args, { encoding: 'utf8', stdio: 'pipe' });
		return { status: 0, stdout, stderr: '' };
	} catch (err) {
		const e = err as { status?: number; stdout?: string; stderr?: string };
		// A missing executable bit or a missing interpreter surfaces with no exit status. Rethrow
		// so it fails loudly instead of being read as an ordinary non-zero result.
		if (typeof e.status !== 'number') throw err;
		return { status: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
	}
}

describe('scripts/check-version-sync.sh', () => {
	let tmpDir: string;
	let pairSeq = 0;

	beforeAll(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-version-sync-'));
	});

	afterAll(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// Writes a package.json / package-lock.json pair and returns the two paths. Each pair gets its
	// own directory so a fixture can omit a file without disturbing another test.
	function pair(pkg: unknown, lock: unknown): [string, string] {
		const dir = path.join(tmpDir, `pair-${pairSeq++}`);
		fs.mkdirSync(dir);
		const pkgPath = path.join(dir, 'package.json');
		const lockPath = path.join(dir, 'package-lock.json');
		fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
		fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf8');
		return [pkgPath, lockPath];
	}

	function lockFor(topVersion: unknown, rootVersion: unknown): Record<string, unknown> {
		const root: Record<string, unknown> = { name: 'n8n-nodes-tallyfy', license: 'MIT' };
		if (rootVersion !== undefined) root.version = rootVersion;
		const lock: Record<string, unknown> = {
			name: 'n8n-nodes-tallyfy',
			lockfileVersion: 3,
			requires: true,
			packages: { '': root, 'node_modules/jest': { version: '29.7.0' } },
		};
		if (topVersion !== undefined) lock.version = topVersion;
		return lock;
	}

	// Both workflows invoke the script directly, so a lost executable bit breaks them and nothing
	// else would notice.
	it('is executable', () => {
		expect(() => fs.accessSync(SCRIPT, fs.constants.X_OK)).not.toThrow();
	});

	// The regression lock. This goes red the moment package.json is bumped without regenerating
	// the lock file, which is what happened through 1.1.2 and 1.1.3, and it is what stops #39
	// recurring.
	it('this repo package.json and package-lock.json agree', () => {
		const res = run();
		expect(res.stdout + res.stderr).toContain('check-version-sync');
		expect(res.status).toBe(0);
	});

	it('passes when all three version fields agree', () => {
		const [pkg, lock] = pair({ name: 'x', version: '1.1.3' }, lockFor('1.1.3', '1.1.3'));
		expect(run(pkg, lock).status).toBe(0);
	});

	// The exact shape of #39: package.json ahead, both lock fields behind.
	it('fails when the lock file is behind package.json', () => {
		const [pkg, lock] = pair({ name: 'x', version: '1.1.3' }, lockFor('1.1.1', '1.1.1'));
		const res = run(pkg, lock);
		expect(res.status).toBe(1);
		expect(res.stderr).toContain('disagree about the version');
		expect(res.stderr).toContain('1.1.3');
		expect(res.stderr).toContain('1.1.1');
	});

	// A lock file records the root version twice. Checking only the top-level one would pass a
	// half-updated lock, so each field is asserted on its own.
	it('fails when only the top-level lock version disagrees', () => {
		const [pkg, lock] = pair({ name: 'x', version: '2.0.0' }, lockFor('1.9.0', '2.0.0'));
		expect(run(pkg, lock).status).toBe(1);
	});

	it('fails when only packages[""].version disagrees', () => {
		const [pkg, lock] = pair({ name: 'x', version: '2.0.0' }, lockFor('2.0.0', '1.9.0'));
		expect(run(pkg, lock).status).toBe(1);
	});

	// The emptiness guard, and these three are the reason it exists. Every one of them makes the
	// comparison read "" against "" against "", which an unguarded equality test satisfies. A gate
	// that reports OK when it cannot read its own inputs is the one failure mode a gate must not
	// have, so these require 2 rather than 0, and 2 is distinct from the 1 that means real drift.
	it('exits 2, not 0, when no file has a version field', () => {
		const [pkg, lock] = pair({ name: 'x' }, lockFor(undefined, undefined));
		const res = run(pkg, lock);
		expect(res.status).toBe(2);
		expect(res.stderr).toContain('absent or not a string');
	});

	it('exits 2 when only package.json is missing its version', () => {
		const [pkg, lock] = pair({ name: 'x' }, lockFor('1.1.3', '1.1.3'));
		expect(run(pkg, lock).status).toBe(2);
	});

	it('exits 2 when packages[""] is absent entirely', () => {
		const [pkg, lock] = pair(
			{ name: 'x', version: '1.1.3' },
			{ name: 'x', version: '1.1.3', lockfileVersion: 3, packages: {} },
		);
		expect(run(pkg, lock).status).toBe(2);
	});

	// A version that parses but is not a string is the same hazard wearing a different shape: it
	// must not be coerced into a comparison.
	it('exits 2 when a version field is not a string', () => {
		const [pkg, lock] = pair({ name: 'x', version: 113 }, lockFor('1.1.3', '1.1.3'));
		expect(run(pkg, lock).status).toBe(2);
	});

	// The negative half of the guard. A check that refuses everything is as useless as one that
	// accepts everything, so a well-formed pair must still pass after all the failure cases above.
	it('still passes a well-formed pair after the guard cases', () => {
		const [pkg, lock] = pair({ name: 'x', version: '9.9.9' }, lockFor('9.9.9', '9.9.9'));
		expect(run(pkg, lock).status).toBe(0);
	});

	// The fields are read as JSON rather than grepped, so a dependency that happens to carry the
	// version being looked for cannot stand in for the root one. Without this, a text scan would
	// find "1.1.3" in the lock file and call it synced.
	it('does not accept a dependency version in place of the root version', () => {
		const lock = lockFor('1.1.1', '1.1.1') as Record<string, unknown>;
		(lock.packages as Record<string, unknown>)['node_modules/some-dep'] = { version: '1.1.3' };
		const [pkgPath, lockPath] = pair({ name: 'x', version: '1.1.3' }, lock);
		expect(run(pkgPath, lockPath).status).toBe(1);
	});

	// Both failure modes exit 2, distinct from the exit 1 that means real drift, so a broken
	// invocation can never be mistaken for a clean verdict in either direction.
	it('exits 2 when package.json does not exist', () => {
		const [, lock] = pair({ name: 'x', version: '1.0.0' }, lockFor('1.0.0', '1.0.0'));
		const res = run(path.join(tmpDir, 'does-not-exist.json'), lock);
		expect(res.status).toBe(2);
		expect(res.stderr).toContain('no such file');
	});

	it('exits 2 when the lock file is not valid JSON', () => {
		const [pkg] = pair({ name: 'x', version: '1.0.0' }, lockFor('1.0.0', '1.0.0'));
		const broken = path.join(tmpDir, 'broken-lock.json');
		fs.writeFileSync(broken, '{ not json', 'utf8');
		const res = run(pkg, broken);
		expect(res.status).toBe(2);
		expect(res.stderr).toContain('BROKEN');
	});
});
