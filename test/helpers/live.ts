import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { IDataObject, IHttpRequestOptions, INodeExecutionData } from 'n8n-workflow';
import { TallyfyApi } from '../../credentials/TallyfyApi.credentials';
import { Tallyfy } from '../../nodes/Tallyfy/Tallyfy.node';
import { createContextMock } from './mocks';

/**
 * Live integration harness. Instead of mocking `httpRequestWithAuthentication`, we swap in a
 * faithful `fetch` shim that applies the REAL TallyfyApi credential's `authenticate` headers and
 * talks to staging. That means the node's actual execute() runs end to end: real parameter reads,
 * real endpoint/method/body/qs building, real response handling (pagination, idFinder shaping,
 * comment-thread extraction), against the real API. Only n8n's transport layer is substituted -
 * which in production is provided by n8n core, not by this node - so this is the correct boundary.
 *
 * The whole suite is gated behind TALLYFY_LIVE=1 so the mocked unit tests keep running without
 * credentials or network.
 */

/** Run the live suite only when explicitly enabled. */
export const LIVE = process.env.TALLYFY_LIVE === '1';

/**
 * The designated staging test org ("Test Org staging2 1"). Deliberately NOT the org_id inside the
 * credentials file (that is a different staging org); overridable via env for other environments.
 */
export const TEST_ORG = process.env.TALLYFY_TEST_ORG || '1505bb7b9ba5f8972ffd3fe1ca18ec0c';

/** Shared prefix + a random suffix so every artifact self-identifies and the sweeper can find it. */
export const PREFIX = 'mwtest-n8n';
export function uniq(tag: string): string {
	const rand = Math.floor(Math.random() * 1e9).toString(36);
	return `${PREFIX}-${tag}-${Date.now().toString(36)}${rand}`;
}

export interface LiveCreds {
	accessToken: string;
	baseUrl: string;
	organizationId: string;
	userId?: string | number;
}

let cachedCreds: LiveCreds | null = null;

/** Load staging credentials from the gitignored JSON at the GitHub root (path overridable). */
export function loadCreds(): LiveCreds {
	if (cachedCreds) return cachedCreds;
	const path =
		process.env.TALLYFY_STAGING_CREDS ||
		join(homedir(), 'Documents', 'GitHub', 'tallyfy_staging_credentials.json');
	const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
	if (!raw.access_token) {
		throw new Error(`Staging credentials at ${path} have no access_token`);
	}
	cachedCreds = {
		accessToken: raw.access_token,
		baseUrl: raw.api_endpoint || 'https://staging.go.tallyfy.com/api',
		organizationId: TEST_ORG,
		userId: raw.user_id,
	};
	return cachedCreds;
}

/**
 * Resolve the credential's `authenticate.properties.headers` exactly as n8n would: strip the
 * leading `=` expression marker and substitute `{{$credentials.X}}`. Reading them off the real
 * TallyfyApi class means a change to the credential's auth headers is picked up by the live suite.
 */
function resolveAuthHeaders(creds: LiveCreds): Record<string, string> {
	const cred = new TallyfyApi();
	const headers = (cred.authenticate as { properties?: { headers?: Record<string, string> } })
		.properties?.headers;
	const out: Record<string, string> = {};
	const bag = creds as unknown as Record<string, string>;
	for (const [key, tmpl] of Object.entries(headers || {})) {
		out[key] = String(tmpl)
			.replace(/^=/, '')
			.replace(/\{\{\s*\$credentials\.(\w+)\s*\}\}/g, (_m, name) => bag[name] ?? '');
	}
	return out;
}

/**
 * Faithful stand-in for n8n's `httpRequestWithAuthentication`: apply credential auth, serialise the
 * query string and JSON body, fetch, and either return the parsed body or throw on a non-2xx (as
 * n8n core does, surfacing the API message so the node's catch/continueOnFail path behaves normally).
 */
export async function liveHttp(
	_credentialName: string,
	options: IHttpRequestOptions,
): Promise<unknown> {
	const creds = loadCreds();
	const url = new URL(options.url as string);
	if (options.qs) {
		for (const [key, value] of Object.entries(options.qs)) {
			if (value !== undefined && value !== null && value !== '') {
				url.searchParams.set(key, String(value));
			}
		}
	}
	const headers: Record<string, string> = {
		...((options.headers as Record<string, string>) || {}),
		...resolveAuthHeaders(creds),
	};
	const method = (options.method || 'GET').toUpperCase();
	const init: RequestInit = { method, headers };
	if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
		init.body =
			typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
	}

	const res = await fetch(url.toString(), init);
	const text = await res.text();
	let parsed: unknown;
	if (text) {
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = text;
		}
	}
	if (!res.ok) {
		const detail =
			parsed && typeof parsed === 'object' ? JSON.stringify(parsed) : String(text).slice(0, 400);
		const err = new Error(`Tallyfy API ${res.status} ${res.statusText}: ${detail}`) as Error & {
			statusCode: number;
			httpCode: string;
			response: unknown;
		};
		err.statusCode = res.status;
		err.httpCode = String(res.status);
		err.response = parsed;
		throw err;
	}
	return parsed;
}

/**
 * Execute the real Tallyfy node against staging with the given node parameters. Returns the node's
 * output items plus the captured request options (so a test can assert BOTH the wire request the
 * node built and the live response it produced).
 */
export async function runLive(
	params: Record<string, unknown>,
): Promise<{ out: INodeExecutionData[]; captured: Array<{ options: IHttpRequestOptions }> }> {
	const creds = loadCreds();
	const { ctx, httpMock } = createContextMock({
		params,
		credentials: {
			accessToken: creds.accessToken,
			baseUrl: creds.baseUrl,
			organizationId: creds.organizationId,
		},
		httpImpl: liveHttp,
	});
	const result = (await new Tallyfy().execute.call(ctx)) as INodeExecutionData[][];
	return { out: result[0], captured: httpMock.captured };
}

/**
 * Direct API call that bypasses the node - for test SETUP/TEARDOWN only (creating a step, which the
 * node has no operation for, and sweeping leftovers). Uses the same auth path as the node.
 */
export async function rawApi(
	method: 'GET' | 'POST' | 'PUT' | 'DELETE',
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<IDataObject> {
	const creds = loadCreds();
	return (await liveHttp('tallyfyApi', {
		method,
		url: `${creds.baseUrl}${path}`,
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		qs: qs || {},
		body,
	} as IHttpRequestOptions)) as IDataObject;
}

/** Unwrap `{ data: ... }` envelopes the API wraps most resources in. */
export function data<T = IDataObject>(resp: unknown): T {
	if (resp && typeof resp === 'object' && 'data' in (resp as IDataObject)) {
		return (resp as IDataObject).data as T;
	}
	return resp as T;
}
