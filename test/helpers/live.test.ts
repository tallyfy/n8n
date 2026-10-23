/* eslint-disable @n8n/community-nodes/no-restricted-imports, @n8n/community-nodes/no-restricted-globals --
 * Those two rules guard code that runs inside n8n. This is a Jest test of the live suite's
 * credentials lookup, which reads the environment and the file system. It never ships in the npm
 * package, and n8n's community package scan does not lint test/. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readStagingCreds, stagingCredsPath } from './live';

// #59. The live suite reads staging credentials from ~/GitHub/tallyfy_staging_credentials.json
// unless TALLYFY_STAGING_CREDS names another file. It used to fall back to ~/Documents/GitHub,
// which on one of our machines is a nearly empty folder that is not the GitHub root.
//
// The environment and the home directory are passed in. Setting process.env.HOME inside a Jest
// test does not reach os.homedir(), which reads the worker's real environment (measured in CI on
// tallyfy/n8n#60), so a test that relied on it would be checking the runner's home instead.
describe('live suite staging credentials path (#59)', () => {
	let home: string;

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-live-creds-'));
	});

	afterEach(() => {
		fs.rmSync(home, { recursive: true, force: true });
	});

	function plant(file: string, token: string): void {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify({ access_token: token }));
	}

	it('defaults to tallyfy_staging_credentials.json under ~/GitHub', () => {
		expect(stagingCredsPath({}, home)).toBe(
			path.join(home, 'GitHub', 'tallyfy_staging_credentials.json'),
		);
		// With nothing passed it uses the real home directory.
		expect(stagingCredsPath({})).toBe(
			path.join(os.homedir(), 'GitHub', 'tallyfy_staging_credentials.json'),
		);
	});

	it('uses TALLYFY_STAGING_CREDS when it is set', () => {
		const elsewhere = path.join(home, 'elsewhere', 'creds.json');
		expect(stagingCredsPath({ TALLYFY_STAGING_CREDS: elsewhere }, home)).toBe(elsewhere);
	});

	it('does not fall back to ~/Documents/GitHub, and names the path it wanted', () => {
		plant(path.join(home, 'Documents', 'GitHub', 'tallyfy_staging_credentials.json'), 'docs-token');
		expect(() => readStagingCreds(stagingCredsPath({}, home))).toThrow(
			`No staging credentials at ${path.join(home, 'GitHub', 'tallyfy_staging_credentials.json')}.`,
		);
	});

	it('reads the file at ~/GitHub', () => {
		plant(path.join(home, 'Documents', 'GitHub', 'tallyfy_staging_credentials.json'), 'docs-token');
		plant(path.join(home, 'GitHub', 'tallyfy_staging_credentials.json'), 'github-token');
		expect(readStagingCreds(stagingCredsPath({}, home)).accessToken).toBe('github-token');
	});
});
