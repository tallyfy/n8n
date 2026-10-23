/* eslint-disable @n8n/community-nodes/no-restricted-imports, @n8n/community-nodes/no-restricted-globals --
 * Those two rules guard code that runs inside n8n. This is a Jest test that reads the repository's
 * workflow files. It never ships in the npm package, and n8n's community package scan does not
 * lint test/. */
import * as fs from 'fs';
import * as path from 'path';

// tallyfy/n8n#52. release.yml used to install `npm@latest` before publishing, so each release ran
// whatever npm was newest that day, an npm no pull request had ever run. The v1.2.0 tag got npm
// 12.2.1, whose `npm pack --json` output has a different shape from the npm 10 that CI used, and
// the release stopped at the pack check without publishing. release.yml now pins an exact npm and
// ci.yml's build job installs the same one, so pull requests run the pack check under the npm a
// release will use. This keeps the two from drifting apart again: a release step can only be
// exercised by pushing a tag, which publishes, so the agreement is checked here instead.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RELEASE = path.join(REPO_ROOT, '.github', 'workflows', 'release.yml');
const CI = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

const EXACT = /^\d+\.\d+\.\d+$/;

// Every npm version a workflow installs globally, read from lines that are not YAML comments, so
// the comments that explain the pin cannot satisfy or break it.
function npmPins(yamlText: string): string[] {
	const pins: string[] = [];
	for (const line of yamlText.split('\n')) {
		if (/^\s*#/.test(line)) continue;
		const m = /\bnpm install -g npm@(\S+)/.exec(line);
		if (m) pins.push(m[1]);
	}
	return pins;
}

describe('the npm version release.yml publishes with', () => {
	// Controls on the reader itself, so the two real-file cases below cannot pass because it reads
	// nothing or reads everything.
	it('the reader finds a pin in a step and ignores the same text in a comment', () => {
		expect(npmPins('        run: |\n          npm install -g npm@12.0.2\n')).toEqual(['12.0.2']);
		expect(npmPins('      # npm install -g npm@12.0.2 is what this used to say\n')).toEqual([]);
	});

	it('an exact version passes the pin rule, and latest or a range does not', () => {
		expect(EXACT.test(npmPins('npm install -g npm@12.0.2')[0])).toBe(true);
		for (const loose of ['latest', '^12.0.2', '12', '12.x', '>=12.0.2']) {
			expect(EXACT.test(npmPins(`npm install -g npm@${loose}`)[0])).toBe(false);
		}
	});

	it('release.yml installs exactly one npm, at an exact version', () => {
		const pins = npmPins(fs.readFileSync(RELEASE, 'utf8'));
		expect(pins).toHaveLength(1);
		expect(pins[0]).toMatch(EXACT);
	});

	it('ci.yml installs the same npm as release.yml', () => {
		const release = npmPins(fs.readFileSync(RELEASE, 'utf8'));
		const ci = npmPins(fs.readFileSync(CI, 'utf8'));
		expect(release).toHaveLength(1);
		expect(ci).toHaveLength(1);
		expect(ci[0]).toBe(release[0]);
	});
});
