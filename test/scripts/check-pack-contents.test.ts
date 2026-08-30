import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Guards scripts/check-pack-contents.sh, which package.json's "prepublishOnly" runs after the
// build, .github/workflows/ci.yml runs on every pull request and push to main, and
// .github/workflows/release.yml runs as a backstop before publishing.
//
// The release workflow step itself can only be exercised by pushing a v* tag, and a tag push in
// this repo publishes to npm immediately and irreversibly (even a failed run signs a permanent
// public provenance statement). So the guard lives in a script and its behaviour is proven here.
//
// Issue #45: package.json carries "files": ["dist"], dist is a gitignored build output, and
// `npm pack` on a tree that was never built does not complain. Measured 2026-08-30 on a clean
// checkout, both arms of the same probe: with no dist, rc 0 and a 4-entry tarball holding
// LICENSE, README.md, index.js and package.json; with dist present, rc 0 and 14 entries. So npm
// would build and publish a package containing none of the code and report success.
//
// The assertions here are on the tarball CONTENTS rather than on npm pack's exit code, because
// the exit code is the thing that is wrong. Asserting it would be asserting the defect.
//
// Both directions are asserted rather than only the failing one. A gate that refuses everything
// is indistinguishable from a working gate if you only ever test the red case.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-pack-contents.sh');

// npm pack spawns a real npm, which takes a few hundred milliseconds per case locally and can be
// slower on a loaded CI runner, so these do not rely on jest's 5s default.
const TIMEOUT_MS = 30_000;

interface RunResult {
	status: number;
	stdout: string;
	stderr: string;
}

// Invokes the script directly rather than through `bash`, so a lost executable bit fails here
// rather than at publish time.
function run(pkgDir?: string): RunResult {
	const args = pkgDir === undefined ? [] : [pkgDir];
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

describe('scripts/check-pack-contents.sh', () => {
	let tmpDir: string;
	let seq = 0;

	beforeAll(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-check-pack-'));
	});

	afterAll(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	const NODES = ['dist/nodes/Tallyfy/Tallyfy.node.js', 'dist/nodes/Tallyfy/TallyfyTrigger.node.js'];
	const CREDS = ['dist/credentials/TallyfyApi.credentials.js'];

	// Builds a package directory. `declared` is what package.json's n8n block claims; `present` is
	// what actually exists on disk under it. Splitting the two is the whole point: the defect is
	// that npm packs happily when they disagree. A `declared` of null omits the n8n block entirely,
	// which is a different case from an empty one.
	function pkg(
		declared: { nodes?: string[]; credentials?: string[] } | null,
		present: string[],
	): string {
		const dir = path.join(tmpDir, `pkg-${seq++}`);
		fs.mkdirSync(dir, { recursive: true });
		const manifest: Record<string, unknown> = {
			name: 'fixture-nodes-tallyfy',
			version: '1.0.0',
			main: 'index.js',
			files: ['dist'],
			private: true,
		};
		if (declared !== null) {
			manifest.n8n = { n8nNodesApiVersion: 1, ...declared };
		}
		fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2), 'utf8');
		fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = {};\n', 'utf8');
		for (const rel of present) {
			const full = path.join(dir, rel);
			fs.mkdirSync(path.dirname(full), { recursive: true });
			fs.writeFileSync(full, 'module.exports = {};\n', 'utf8');
		}
		return dir;
	}

	// prepublishOnly, ci.yml and release.yml all invoke the script by path, so a lost executable
	// bit breaks all three and nothing else would notice.
	it('is executable', () => {
		expect(() => fs.accessSync(SCRIPT, fs.constants.X_OK)).not.toThrow();
	});

	// Non-vacuity on the real package. The green direction against this repository's own built
	// tree is deliberately NOT asserted here: the CI test job does not build, so dist is absent
	// there and such a test would report a defect that is not one. What can be asserted without a
	// build is that this package still declares entry points for the check to look for, so a
	// removal or rename of the n8n block shows up here rather than turning the check vacuous.
	it('this repo declares n8n entry points, so the check is never vacuous', () => {
		const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
		const declared = [...(manifest.n8n?.nodes ?? []), ...(manifest.n8n?.credentials ?? [])];
		expect(declared.length).toBeGreaterThan(0);
		for (const p of declared) expect(typeof p).toBe('string');
	});

	it(
		'passes when every declared entry point is in the tarball',
		() => {
			const dir = pkg({ nodes: NODES, credentials: CREDS }, [...NODES, ...CREDS]);
			const res = run(dir);
			expect(res.status).toBe(0);
			expect(res.stdout).toContain('check-pack-contents: OK');
			expect(res.stdout).toContain('all 3 declared entry point(s)');
		},
		TIMEOUT_MS,
	);

	// The RED direction, and the exact shape of #45: a tree that was never built. npm exits 0 and
	// produces a tarball with none of the code in it.
	it(
		'fails when there is no build output at all',
		() => {
			const dir = pkg({ nodes: NODES, credentials: CREDS }, []);
			const res = run(dir);
			expect(res.status).toBe(1);
			expect(res.stderr).toContain('missing 3 of 3 declared entry point(s)');
			// Named, not counted. A broken version of the script cannot satisfy this by returning a
			// plausible number, which a bare "it refused" assertion would accept.
			for (const p of [...NODES, ...CREDS]) expect(res.stderr).toContain(p);
		},
		TIMEOUT_MS,
	);

	// The tarball is not empty in that case, which is what makes the defect invisible: npm always
	// includes package.json and the file named by `main`. So "the tarball has a .js in it" is a
	// check that passes on a package holding no code, and this asserts the listing the failure
	// message prints so the reader can see exactly that.
	it(
		'reports what the unbuilt tarball would actually contain',
		() => {
			const dir = pkg({ nodes: NODES, credentials: CREDS }, []);
			const res = run(dir);
			expect(res.status).toBe(1);
			expect(res.stderr).toContain('package.json');
			expect(res.stderr).toContain('index.js');
		},
		TIMEOUT_MS,
	);

	it(
		'fails when only some of the declared entry points are present',
		() => {
			const dir = pkg({ nodes: NODES, credentials: CREDS }, [NODES[0]]);
			const res = run(dir);
			expect(res.status).toBe(1);
			expect(res.stderr).toContain('missing 2 of 3');
			expect(res.stderr).toContain(NODES[1]);
			expect(res.stderr).toContain(CREDS[0]);
		},
		TIMEOUT_MS,
	);

	// A credential is as load-bearing as a node, and a check that only read n8n.nodes would pass
	// this. Both lists are read, so this fails.
	it(
		'fails when the nodes are present but the credential is not',
		() => {
			const dir = pkg({ nodes: NODES, credentials: CREDS }, NODES);
			const res = run(dir);
			expect(res.status).toBe(1);
			expect(res.stderr).toContain('missing 1 of 3');
			expect(res.stderr).toContain(CREDS[0]);
		},
		TIMEOUT_MS,
	);

	// A file that exists on disk but is outside what `files` ships is still missing from the
	// tarball, and this is the case a plain `test -f` would pass. The assertion is on what npm
	// would actually put in the package, not on what is lying around in the working tree.
	it(
		'fails when a declared file exists on disk but is excluded from the tarball',
		() => {
			const dir = pkg({ nodes: ['outside/Tallyfy.node.js'] }, ['outside/Tallyfy.node.js']);
			expect(fs.existsSync(path.join(dir, 'outside/Tallyfy.node.js'))).toBe(true);
			const res = run(dir);
			expect(res.status).toBe(1);
			expect(res.stderr).toContain('outside/Tallyfy.node.js');
		},
		TIMEOUT_MS,
	);

	// The vacuity refusal, and it is the reason this script refuses rather than passes. With
	// nothing declared, "every declared path is in the tarball" is satisfied by any tarball at
	// all, including one carrying no code. This requires 2 rather than 0, and 2 is distinct from
	// the 1 that means a real mismatch, so a check that could not run is never read as a clean
	// verdict.
	it(
		'exits 2, not 0, when package.json declares no entry points',
		() => {
			const dir = pkg(null, []);
			const res = run(dir);
			expect(res.status).toBe(2);
			expect(res.stderr).toContain('declares no n8n.nodes or n8n.credentials paths');
		},
		TIMEOUT_MS,
	);

	it(
		'exits 2 when the n8n block is present but its lists are empty',
		() => {
			const dir = pkg({ nodes: [], credentials: [] }, []);
			expect(run(dir).status).toBe(2);
		},
		TIMEOUT_MS,
	);

	it('exits 2 when the package directory does not exist', () => {
		const res = run(path.join(tmpDir, 'no-such-dir'));
		expect(res.status).toBe(2);
		expect(res.stderr).toContain('no such package directory');
	});

	it('exits 2 when the directory holds no package.json', () => {
		const dir = path.join(tmpDir, `empty-${seq++}`);
		fs.mkdirSync(dir, { recursive: true });
		const res = run(dir);
		expect(res.status).toBe(2);
		expect(res.stderr).toContain('no package.json');
	});

	it(
		'exits 2 when package.json cannot be parsed',
		() => {
			const dir = path.join(tmpDir, `bad-${seq++}`);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, 'package.json'), '{ not json', 'utf8');
			const res = run(dir);
			expect(res.status).toBe(2);
			expect(res.stderr).toContain('BROKEN');
		},
		TIMEOUT_MS,
	);

	// The negative half of the guard. A check that refuses everything is as useless as one that
	// accepts everything, so a well-formed package must still pass after all the failure cases.
	it(
		'still passes a well-formed package after the failure cases',
		() => {
			const dir = pkg({ nodes: NODES, credentials: CREDS }, [...NODES, ...CREDS]);
			expect(run(dir).status).toBe(0);
		},
		TIMEOUT_MS,
	);
});
