import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Guards scripts/check-icons.sh, which package.json's "build" runs on every build,
// .github/workflows/ci.yml runs on every pull request and push to main, and
// .github/workflows/release.yml runs as a backstop before publishing.
//
// The release workflow step itself can only be exercised by pushing a v* tag, and a tag push in
// this repo publishes to npm immediately and irreversibly (even a failed run signs a permanent
// public provenance statement). So the guard lives in a script and its behaviour is proven here.
//
// Issue #43: `gulp build:icons` is `src('nodes/**/*.svg').pipe(dest('dist/nodes'))`. A glob with
// magic characters does not error when it matches nothing, so gulp copied zero files and exited
// 0, and `npm run build` exited 0 with it. Measured before the fix, with the glob pointed at
// `nodes/**/*.svg.notreal` and dist removed first: build exit 0, zero svg under dist/nodes.
//
// Both directions are asserted here rather than only the failing one. A gate that refuses
// everything is indistinguishable from a working gate if you only ever test the red case.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-icons.sh');

interface RunResult {
	status: number;
	stdout: string;
	stderr: string;
}

// Invokes the script directly rather than through `bash`, so a lost executable bit fails here
// rather than at build or release time.
function run(srcDir?: string, outDir?: string): RunResult {
	const args: string[] = [];
	if (srcDir !== undefined) args.push(srcDir);
	if (outDir !== undefined) args.push(outDir);
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

describe('scripts/check-icons.sh', () => {
	let tmpDir: string;
	let treeSeq = 0;

	beforeAll(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-check-icons-'));
	});

	afterAll(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// Builds a source tree and an output tree from two lists of relative paths, and returns the
	// two directory paths. Each pair gets its own directory so one fixture cannot disturb another.
	// A list given as null means that directory is not created at all, which is a different case
	// from an empty one.
	function trees(srcFiles: string[] | null, outFiles: string[] | null): [string, string] {
		const dir = path.join(tmpDir, `tree-${treeSeq++}`);
		const srcDir = path.join(dir, 'nodes');
		const outDir = path.join(dir, 'dist', 'nodes');
		fs.mkdirSync(dir, { recursive: true });
		for (const [target, files] of [
			[srcDir, srcFiles],
			[outDir, outFiles],
		] as [string, string[] | null][]) {
			if (files === null) continue;
			fs.mkdirSync(target, { recursive: true });
			for (const rel of files) {
				const full = path.join(target, rel);
				fs.mkdirSync(path.dirname(full), { recursive: true });
				fs.writeFileSync(full, '<svg/>', 'utf8');
			}
		}
		return [srcDir, outDir];
	}

	// package.json's "build", ci.yml and release.yml all invoke the script by path, so a lost
	// executable bit breaks all three and nothing else would notice.
	it('is executable', () => {
		expect(() => fs.accessSync(SCRIPT, fs.constants.X_OK)).not.toThrow();
	});

	// The GREEN direction on the real repository. This is not a fixture: it asserts the icons this
	// package actually ships are found where the script looks for them, so a rename of nodes/ or a
	// change to the gulp destination shows up here.
	it('this repo has at least one source icon, so the check is never vacuous', () => {
		const srcDir = path.join(REPO_ROOT, 'nodes');
		const found = fs
			.readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
			.filter((p) => p.endsWith('.svg'));
		expect(found.length).toBeGreaterThan(0);
	});

	it('passes when every source icon is present in the output', () => {
		const [src, out] = trees(['Tallyfy/tallyfy.svg'], ['Tallyfy/tallyfy.svg']);
		const res = run(src, out);
		expect(res.status).toBe(0);
		expect(res.stdout).toContain('check-icons: OK');
	});

	it('passes with several icons across subdirectories', () => {
		const files = ['Tallyfy/tallyfy.svg', 'Tallyfy/nested/other.svg', 'top.svg'];
		const [src, out] = trees(files, files);
		expect(run(src, out).status).toBe(0);
	});

	// The RED direction, and the exact shape of #43: gulp matched nothing, copied nothing, exited
	// 0. The output directory exists because tsc created it, and holds no icons at all.
	it('fails when the copy produced no icons at all', () => {
		const [src, out] = trees(['Tallyfy/tallyfy.svg'], []);
		const res = run(src, out);
		expect(res.status).toBe(1);
		expect(res.stderr).toContain('did not reproduce the source set');
		expect(res.stderr).toContain('Tallyfy/tallyfy.svg');
	});

	it('fails when only some of the icons were copied', () => {
		const [src, out] = trees(
			['Tallyfy/a.svg', 'Tallyfy/b.svg', 'Tallyfy/c.svg'],
			['Tallyfy/a.svg'],
		);
		const res = run(src, out);
		expect(res.status).toBe(1);
		expect(res.stderr).toContain('Tallyfy/b.svg');
		expect(res.stderr).toContain('Tallyfy/c.svg');
		expect(res.stderr).not.toContain('Tallyfy/a.svg');
	});

	// A count-only comparison passes this, which is why the relative paths are compared too. It is
	// what a stale dist looks like after an icon is renamed.
	it('fails when the counts match but the names do not', () => {
		const [src, out] = trees(['Tallyfy/new-name.svg'], ['Tallyfy/old-name.svg']);
		const res = run(src, out);
		expect(res.status).toBe(1);
		expect(res.stderr).toContain('new-name.svg');
		expect(res.stderr).toContain('output tree is stale');
	});

	it('fails when the output holds an icon the source no longer has', () => {
		const [src, out] = trees(['Tallyfy/a.svg'], ['Tallyfy/a.svg', 'Tallyfy/removed.svg']);
		const res = run(src, out);
		expect(res.status).toBe(1);
		expect(res.stderr).toContain('removed.svg');
	});

	// The vacuity refusal, and it is the reason this script exists rather than a bare equality
	// test. Zero output files equal zero source files, so an unguarded comparison reports OK
	// forever. This requires 2 rather than 0, and 2 is distinct from the 1 that means a real
	// mismatch, so a check that could not run is never read as a clean verdict.
	it('exits 2, not 0, when there are no source icons to compare', () => {
		const [src, out] = trees([], []);
		const res = run(src, out);
		expect(res.status).toBe(2);
		expect(res.stderr).toContain('nothing to compare');
	});

	it('exits 2 when there are no source icons even though the output has some', () => {
		const [src, out] = trees([], ['Tallyfy/orphan.svg']);
		expect(run(src, out).status).toBe(2);
	});

	// A missing output directory means the build never ran, which is a different statement from
	// "the copy produced nothing". Reporting it as the latter sends someone to debug gulp when
	// they simply never built. Still non-zero, so a workflow step still goes red.
	it('exits 2 when the output directory does not exist', () => {
		const [src, out] = trees(['Tallyfy/a.svg'], null);
		const res = run(src, out);
		expect(res.status).toBe(2);
		expect(res.stderr).toContain('no such output directory');
	});

	it('exits 2 when the source directory does not exist', () => {
		const [src, out] = trees(null, ['Tallyfy/a.svg']);
		const res = run(src, out);
		expect(res.status).toBe(2);
		expect(res.stderr).toContain('no such source directory');
	});

	// The negative half of the guard. A check that refuses everything is as useless as one that
	// accepts everything, so a well-formed pair must still pass after all the failure cases above.
	it('still passes a well-formed pair after the failure cases', () => {
		const [src, out] = trees(['Tallyfy/tallyfy.svg'], ['Tallyfy/tallyfy.svg']);
		expect(run(src, out).status).toBe(0);
	});

	// Only *.svg counts. gulp copies nothing else into dist/nodes that this should compare, and
	// tsc puts .js, .d.ts and .js.map there, so a check that counted every file would fail on
	// every real build.
	it('ignores files that are not .svg on either side', () => {
		const [src, out] = trees(
			['Tallyfy/tallyfy.svg', 'Tallyfy/Tallyfy.node.ts'],
			['Tallyfy/tallyfy.svg', 'Tallyfy/Tallyfy.node.js', 'Tallyfy/Tallyfy.node.d.ts'],
		);
		expect(run(src, out).status).toBe(0);
	});
});
