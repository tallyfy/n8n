import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Guards scripts/check-changelog.sh, which .github/workflows/release.yml runs before publishing.
//
// The workflow step itself can only be exercised by pushing a v* tag, and a tag push in this repo
// publishes to npm immediately and irreversibly (even a failed run signs a permanent public
// provenance statement). So the guard lives in a script and its behaviour is proven here instead.
//
// Issue #18: 1.1.0, 1.1.1 and 1.1.2 all shipped with no CHANGELOG entry.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-changelog.sh');

interface RunResult {
	status: number;
	stdout: string;
	stderr: string;
}

// Invokes the script directly rather than through `bash`, so a lost executable bit fails here
// rather than at release time.
function run(version?: string, changelog?: string): RunResult {
	const args: string[] = [];
	if (version !== undefined) args.push(version);
	if (changelog !== undefined) args.push(changelog);
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

describe('scripts/check-changelog.sh', () => {
	let tmpDir: string;

	beforeAll(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-changelog-'));
	});

	afterAll(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function fixture(name: string, contents: string): string {
		const file = path.join(tmpDir, name);
		fs.writeFileSync(file, contents, 'utf8');
		return file;
	}

	// release.yml invokes the script directly, so a lost executable bit breaks the release and
	// nothing else would notice.
	it('is executable', () => {
		expect(() => fs.accessSync(SCRIPT, fs.constants.X_OK)).not.toThrow();
	});

	// The regression lock. This goes red the moment package.json is bumped without a CHANGELOG
	// entry, which is months before anyone reaches for a tag, and it is what stops #18 recurring.
	it('the version in package.json has a CHANGELOG heading', () => {
		const pkg = JSON.parse(
			fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
		) as { version: string };
		const res = run(pkg.version);
		expect(res.stdout + res.stderr).toContain(pkg.version);
		expect(res.status).toBe(0);
	});

	it('passes when the version has a heading', () => {
		const file = fixture('has.md', '# Changelog\n\n## [2.0.0] - 2026-01-01\n\n### Added\n- thing\n');
		expect(run('2.0.0', file).status).toBe(0);
	});

	it('fails when the version has no heading', () => {
		const file = fixture('missing.md', '# Changelog\n\n## [2.0.0] - 2026-01-01\n');
		const res = run('2.0.1', file);
		expect(res.status).toBe(1);
		expect(res.stderr).toContain('no heading for 2.0.1');
	});

	it('accepts the tag form with a leading v', () => {
		const file = fixture('vform.md', '# Changelog\n\n## [2.0.0] - 2026-01-01\n');
		expect(run('v2.0.0', file).status).toBe(0);
	});

	// The version being named somewhere in the file is not the same as it having an entry. Without
	// this the release-history note in CHANGELOG.md, which names 1.1.0 and 1.1.1 in prose, would
	// make the guard pass for two versions that deliberately have no entry.
	it('does not accept a version mentioned only in prose', () => {
		const file = fixture(
			'prose.md',
			'# Changelog\n\n1.1.1 was hand-published from an untagged tree.\n\n## [2.0.0] - 2026-01-01\n',
		);
		expect(run('1.1.1', file).status).toBe(1);
	});

	it('does not accept a heading that merely starts with the version', () => {
		const file = fixture('prefix.md', '# Changelog\n\n## [1.1.20] - 2026-01-01\n');
		expect(run('1.1.2', file).status).toBe(1);
		expect(run('1.1.20', file).status).toBe(0);
	});

	it('does not accept a sub-heading', () => {
		const file = fixture('sub.md', '# Changelog\n\n### [3.0.0] - 2026-01-01\n');
		expect(run('3.0.0', file).status).toBe(1);
	});

	// Both failure modes exit 2, distinct from the exit 1 that means "no entry", so a broken
	// invocation can never be mistaken for a clean verdict in either direction.
	it('exits 2 when called with no version', () => {
		const res = run();
		expect(res.status).toBe(2);
		expect(res.stderr).toContain('usage:');
	});

	it('exits 2 when the changelog file does not exist', () => {
		const res = run('1.0.0', path.join(tmpDir, 'does-not-exist.md'));
		expect(res.status).toBe(2);
		expect(res.stderr).toContain('no such file');
	});
});
