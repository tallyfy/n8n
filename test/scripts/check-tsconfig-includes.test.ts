import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Guards scripts/check-tsconfig-includes.sh, which package.json's "build" runs first on every
// build, .github/workflows/ci.yml runs on every pull request and push to main, and
// .github/workflows/release.yml runs as a backstop before publishing.
//
// The release workflow step itself can only be exercised by pushing a v* tag, and a tag push in
// this repo publishes to npm immediately and irreversibly (even a failed run signs a permanent
// public provenance statement). So the guard lives in a script and its behaviour is proven here.
//
// Issue #45: tsc raises TS18003 "No inputs were found" only when EVERY include pattern matches
// nothing. One dead pattern among several is silent and the compile exits 0. Measured 2026-08-30
// with all three arms on one invocation: two real includes plus one bogus one gave rc 0 and no
// output; a single bogus include gave rc 2 and TS18003; a single real include gave rc 0. The live
// instance was `nodes/**/*.json` in tsconfig.json matching 0 files, removed in the same change.
//
// The consequence this protects against is a rename or move of nodes/: `nodes/**/*.ts` would
// silently match nothing, `credentials/**/*.ts` would keep the input set non-empty so TS18003
// never fires, and tsc would emit no node at all while exiting 0.
//
// Both directions are asserted here rather than only the failing one. A gate that refuses
// everything is indistinguishable from a working gate if you only ever test the red case.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-tsconfig-includes.sh');

interface RunResult {
	status: number;
	stdout: string;
	stderr: string;
}

// Invokes the script directly rather than through `bash`, so a lost executable bit fails here
// rather than at build or release time.
function run(args: string[] = [], cwd: string = REPO_ROOT): RunResult {
	try {
		const stdout = execFileSync(SCRIPT, args, { encoding: 'utf8', stdio: 'pipe', cwd });
		return { status: 0, stdout, stderr: '' };
	} catch (err) {
		const e = err as { status?: number; stdout?: string; stderr?: string };
		// A missing executable bit or a missing interpreter surfaces with no exit status. Rethrow
		// so it fails loudly instead of being read as an ordinary non-zero result.
		if (typeof e.status !== 'number') throw err;
		return { status: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
	}
}

describe('scripts/check-tsconfig-includes.sh', () => {
	let tmpDir: string;
	let seq = 0;

	beforeAll(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-check-tsconfig-'));
	});

	afterAll(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// Builds a fixture directory holding some source files and one or more tsconfigs, and returns
	// the directory. Each fixture gets its own directory so one cannot disturb another. The config
	// text is written verbatim, so a fixture can carry jsonc comments exactly as tsconfig.jest.json
	// does.
	function fixture(files: string[], configs: Record<string, string>): string {
		const dir = path.join(tmpDir, `fx-${seq++}`);
		fs.mkdirSync(dir, { recursive: true });
		for (const rel of files) {
			const full = path.join(dir, rel);
			fs.mkdirSync(path.dirname(full), { recursive: true });
			fs.writeFileSync(full, 'export const x = 1;\n', 'utf8');
		}
		for (const [name, body] of Object.entries(configs)) {
			fs.writeFileSync(path.join(dir, name), body, 'utf8');
		}
		return dir;
	}

	function cfg(include: unknown[], exclude?: unknown[]): string {
		const obj: Record<string, unknown> = { compilerOptions: { noEmit: true }, include };
		if (exclude !== undefined) obj.exclude = exclude;
		return JSON.stringify(obj, null, 2);
	}

	// package.json's "build", ci.yml and release.yml all invoke the script by path, so a lost
	// executable bit breaks all three and nothing else would notice.
	it('is executable', () => {
		expect(() => fs.accessSync(SCRIPT, fs.constants.X_OK)).not.toThrow();
	});

	// The GREEN direction on the real repository. This is not a fixture: it asserts every include
	// pattern in this package's own tsconfigs still matches something, so a rename of nodes/,
	// credentials/ or test/ shows up here.
	it('passes on this repository as it stands', () => {
		const res = run();
		expect(res.status).toBe(0);
		expect(res.stdout).toContain('check-tsconfig-includes: OK');
	});

	// Non-vacuity on the real repository, asserted separately from the run above. A tsconfig that
	// lost its include array entirely would make the check refuse rather than pass, but a count
	// here says plainly how many patterns the green verdict above actually covered.
	it('this repo declares include patterns, so the green verdict is not vacuous', () => {
		const raw = fs.readFileSync(path.join(REPO_ROOT, 'tsconfig.json'), 'utf8');
		const include = JSON.parse(raw).include as string[];
		expect(Array.isArray(include)).toBe(true);
		expect(include.length).toBeGreaterThan(0);
		expect(run().stdout).toMatch(/all \d+ include pattern\(s\) across \d+ config\(s\)/);
	});

	// The real tsconfig.jest.json carries // comments. Parsing it with JSON.parse would throw, so
	// the script has to read it the way TypeScript does. The real-repo run above already covers
	// this; this fixture states it outright so a regression names the cause.
	it('reads a config carrying jsonc comments', () => {
		const dir = fixture(
			['src/a.ts'],
			{
				'tsconfig.json':
					'{\n\t// a comment TypeScript accepts and JSON.parse does not\n\t"include": ["src/**/*.ts"]\n}\n',
			},
		);
		const res = run([path.join(dir, 'tsconfig.json')]);
		expect(res.status).toBe(0);
		expect(res.stdout).toContain('OK');
	});

	it('passes when every include pattern matches at least one file', () => {
		const dir = fixture(['src/a.ts', 'other/b.ts'], {
			'tsconfig.json': cfg(['src/**/*.ts', 'other/**/*.ts']),
		});
		const res = run([path.join(dir, 'tsconfig.json')]);
		expect(res.status).toBe(0);
		expect(res.stdout).toContain('all 2 include pattern(s)');
	});

	// The RED direction, and the exact shape of #45: one dead pattern among several, which tsc
	// itself compiles silently because the siblings keep the input set non-empty.
	it('fails when one pattern of several matches nothing', () => {
		const dir = fixture(['src/a.ts'], {
			'tsconfig.json': cfg(['src/**/*.ts', 'src/**/*.json']),
		});
		const res = run([path.join(dir, 'tsconfig.json')]);
		expect(res.status).toBe(1);
		expect(res.stderr).toContain('1 include pattern(s) match no files');
		expect(res.stderr).toContain('src/**/*.json');
	});

	// The count is named, not just the failure. An assertion that only says "it refused" is
	// satisfied by a script that refuses everything.
	it('names every dead pattern when more than one is dead', () => {
		const dir = fixture(['src/a.ts'], {
			'tsconfig.json': cfg(['src/**/*.ts', 'src/**/*.json', 'gone/**/*.ts']),
		});
		const res = run([path.join(dir, 'tsconfig.json')]);
		expect(res.status).toBe(1);
		expect(res.stderr).toContain('2 include pattern(s) match no files');
		expect(res.stderr).toContain('src/**/*.json');
		expect(res.stderr).toContain('gone/**/*.ts');
	});

	// tsc would catch this one on its own with TS18003. The script has to agree with it rather
	// than disagree, or the two gates would give opposite verdicts on the same tree.
	it('fails when the only pattern matches nothing', () => {
		const dir = fixture(['src/a.ts'], { 'tsconfig.json': cfg(['nowhere/**/*.ts']) });
		expect(run([path.join(dir, 'tsconfig.json')]).status).toBe(1);
	});

	// The effective `exclude` is passed through to the matcher, so a pattern whose every match is
	// excluded counts as zero. That is the correct answer: it contributes nothing to the compile.
	// Without passing exclude through, this fixture would report 1 match and pass.
	it('counts a pattern whose only matches are excluded as matching nothing', () => {
		const dir = fixture(['src/a.ts', 'src/b.test.ts'], {
			'tsconfig.json': cfg(['src/**/*.ts', 'src/**/*.test.ts'], ['**/*.test.ts']),
		});
		const res = run([path.join(dir, 'tsconfig.json')]);
		expect(res.status).toBe(1);
		expect(res.stderr).toContain('src/**/*.test.ts');
	});

	// `extends` is resolved before the patterns are read, so a config that inherits its include
	// from a base is checked against the base's patterns rather than skipped as having none.
	it('resolves extends and checks the inherited include', () => {
		const dir = fixture(['src/a.ts'], {
			'tsconfig.base.json': cfg(['src/**/*.ts', 'src/**/*.json']),
			'tsconfig.json': JSON.stringify({ extends: './tsconfig.base.json' }, null, 2),
		});
		const res = run([path.join(dir, 'tsconfig.json')]);
		expect(res.status).toBe(1);
		expect(res.stderr).toContain('src/**/*.json');
	});

	// A config using `files` rather than `include` is legitimate and is not failed. It is only
	// counted as contributing no patterns, which matters for the vacuity guard below.
	it('does not fail a config that declares files rather than include', () => {
		const dir = fixture(['src/a.ts'], {
			'tsconfig.json': cfg(['src/**/*.ts']),
			'tsconfig.files.json': JSON.stringify({ files: ['src/a.ts'] }, null, 2),
		});
		const res = run([path.join(dir, 'tsconfig.json'), path.join(dir, 'tsconfig.files.json')]);
		expect(res.status).toBe(0);
		expect(res.stdout).toContain('all 1 include pattern(s) across 2 config(s)');
	});

	// The vacuity refusal, and it is the reason this script refuses rather than passes. Zero
	// patterns cannot contain an empty one, so an unguarded loop reports OK while examining
	// nothing. This requires 2 rather than 0, and 2 is distinct from the 1 that means a real dead
	// pattern, so a check that could not run is never read as a clean verdict.
	it('exits 2, not 0, when no config declares an include at all', () => {
		const dir = fixture(['src/a.ts'], {
			'tsconfig.json': JSON.stringify({ files: ['src/a.ts'] }, null, 2),
		});
		const res = run([path.join(dir, 'tsconfig.json')]);
		expect(res.status).toBe(2);
		expect(res.stderr).toContain('declare no "include" pattern at all');
	});

	it('exits 2 when an include array is present but empty', () => {
		const dir = fixture(['src/a.ts'], { 'tsconfig.json': cfg([]) });
		expect(run([path.join(dir, 'tsconfig.json')]).status).toBe(2);
	});

	it('exits 2 when a named config file does not exist', () => {
		const dir = fixture(['src/a.ts'], { 'tsconfig.json': cfg(['src/**/*.ts']) });
		const res = run([path.join(dir, 'tsconfig.nope.json')]);
		expect(res.status).toBe(2);
		expect(res.stderr).toContain('no such config file');
	});

	it('exits 2 when a config cannot be parsed', () => {
		const dir = fixture(['src/a.ts'], { 'tsconfig.json': '{ this is not json' });
		const res = run([path.join(dir, 'tsconfig.json')]);
		expect(res.status).toBe(2);
		expect(res.stderr).toContain('BROKEN');
	});

	// The other vacuity refusal: discovery finding nothing. It is only reachable with no arguments
	// and an empty repository root, so the script is copied into a bare tree to reach it. A sweep
	// that discovers nothing passes every assertion made about it, which is the same defect this
	// whole change is about, so the discovery is guarded rather than trusted.
	it('exits 2 when discovery finds no tsconfig at all', () => {
		const dir = path.join(tmpDir, `bare-${seq++}`);
		fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
		const copied = path.join(dir, 'scripts', 'check-tsconfig-includes.sh');
		fs.copyFileSync(SCRIPT, copied);
		fs.chmodSync(copied, 0o755);
		let status = 0;
		let stderr = '';
		try {
			execFileSync(copied, [], { encoding: 'utf8', stdio: 'pipe' });
		} catch (err) {
			const e = err as { status?: number; stderr?: string };
			if (typeof e.status !== 'number') throw err;
			status = e.status;
			stderr = e.stderr ?? '';
		}
		expect(status).toBe(2);
		expect(stderr).toContain('found no tsconfig*.json');
	});

	// The same probe from a different working directory. The script resolves typescript from its
	// own package root, so it must not depend on where the caller was standing.
	it('gives the same verdict when run from an unrelated directory', () => {
		expect(run([], os.tmpdir()).status).toBe(0);
	});

	// The negative half of the guard. A check that refuses everything is as useless as one that
	// accepts everything, so a well-formed config must still pass after all the failure cases.
	it('still passes a well-formed config after the failure cases', () => {
		const dir = fixture(['src/a.ts'], { 'tsconfig.json': cfg(['src/**/*.ts']) });
		expect(run([path.join(dir, 'tsconfig.json')]).status).toBe(0);
	});
});
