import { TallyfyApi } from '../../credentials/TallyfyApi.credentials';

describe('TallyfyApi credential', () => {
	const cred = new TallyfyApi();

	it('is registered under the name the nodes reference', () => {
		expect(cred.name).toBe('tallyfyApi');
		expect(cred.displayName).toBe('Tallyfy API');
	});

	it('defaults the base URL to the verified production host', () => {
		const baseUrlProp = cred.properties.find((p) => p.name === 'baseUrl');
		expect(baseUrlProp).toBeDefined();
		expect(baseUrlProp!.default).toBe('https://go.tallyfy.com/api');
	});

	it('requires an access token and an organization id', () => {
		const accessToken = cred.properties.find((p) => p.name === 'accessToken');
		const organizationId = cred.properties.find((p) => p.name === 'organizationId');
		expect(accessToken!.required).toBe(true);
		expect(organizationId!.required).toBe(true);
		// The token must be masked in the UI.
		expect((accessToken!.typeOptions as { password?: boolean }).password).toBe(true);
	});

	it('authenticates with a Bearer token and the mandatory X-Tallyfy-Client header', () => {
		const headers = cred.authenticate.properties.headers as Record<string, string>;
		expect(headers.Authorization).toBe('=Bearer {{$credentials.accessToken}}');
		// X-Tallyfy-Client is required by the API on every request; it is injected here (not
		// per-request in the node), which is why the request-building tests do not re-assert it.
		expect(headers['X-Tallyfy-Client']).toBe('n8n');
	});

	it('tests the connection against GET /me on the credential base URL', () => {
		expect(cred.test.request.url).toBe('/me');
		expect(cred.test.request.baseURL).toBe('={{$credentials.baseUrl}}');
		const headers = cred.test.request.headers as Record<string, string>;
		expect(headers.Accept).toBe('application/json');
	});
});
