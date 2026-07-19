import type { IDataObject, IHttpRequestOptions, INodeExecutionData } from 'n8n-workflow';

/**
 * Faithful re-implementation of n8n's `this.helpers.returnJsonArray`: wrap each
 * object as `{ json: obj }`. Accepts a single object or an array.
 */
export function returnJsonArray(data: IDataObject | IDataObject[]): INodeExecutionData[] {
	const arr = Array.isArray(data) ? data : [data];
	return arr.map((json) => ({ json }));
}

/**
 * A single captured call to `httpRequestWithAuthentication`. The node invokes it as
 * `this.helpers.httpRequestWithAuthentication.call(this, 'tallyfyApi', options)`.
 *
 * The node's generic request path REUSES one `options` object and mutates its `qs` across the
 * returnAll pagination loop, so jest's own `mock.calls` (which stores args by reference) would show
 * every call with the final query string. We therefore snapshot a deep clone of the args at call
 * time onto `.captured`, and the requestAt/credentialAt helpers read from there.
 */
export type HttpMock = jest.Mock<Promise<unknown>, [string, IHttpRequestOptions]> & {
	captured: Array<{ credentialName: string; options: IHttpRequestOptions }>;
};

export interface ContextMockConfig {
	/** Node parameters keyed by name (item index is ignored; tests use one input item). */
	params?: Record<string, unknown>;
	/** Credentials returned by getCredentials('tallyfyApi'). */
	credentials?: IDataObject;
	/** Input items for execute(); defaults to a single empty item so the loop runs once. */
	inputItems?: INodeExecutionData[];
	/**
	 * Sequential responses for httpRequestWithAuthentication. An entry of the shape
	 * `{ __throw: err }` causes that call to reject with `err` (for error-path tests).
	 * When exhausted the last entry is reused.
	 */
	httpResponses?: unknown[];
	continueOnFail?: boolean;
	/**
	 * Trigger-family contexts (IPollFunctions/IHookFunctions/IWebhookFunctions) drop the itemIndex
	 * argument, so getNodeParameter is (name, fallback?, options?). Set true for those; the default
	 * (false) uses the IExecuteFunctions shape (name, itemIndex, fallback?, options?).
	 */
	triggerStyle?: boolean;
	/** Trigger context: 'manual' (test run) vs 'trigger' (activated) etc. */
	mode?: string;
	/** Workflow static data object; pass the SAME object across polls to persist dedup state. */
	staticData?: IDataObject;
	/** Webhook URL n8n hands to the trigger's subscription lifecycle. */
	webhookUrl?: string | undefined;
	/** Inbound webhook body for the instant-webhook handler. */
	bodyData?: IDataObject;
}

export interface ContextMock {
	/** Cast to whichever n8n function interface a given method needs. */
	ctx: any;
	httpMock: HttpMock;
	staticData: IDataObject;
}

/**
 * Builds a superset mock covering IExecuteFunctions / IPollFunctions / IHookFunctions /
 * IWebhookFunctions. Only the methods a given node method touches are exercised; the rest
 * are harmless. No real network or side effects occur.
 */
export function createContextMock(config: ContextMockConfig = {}): ContextMock {
	const params = config.params ?? {};
	const credentials: IDataObject = config.credentials ?? {
		accessToken: 'test-token',
		baseUrl: 'https://go.tallyfy.com/api',
		organizationId: 'ORG123',
	};
	const inputItems: INodeExecutionData[] = config.inputItems ?? [{ json: {} }];
	const responses = config.httpResponses ?? [{ data: { id: 'RESP1' } }];
	const staticData: IDataObject = config.staticData ?? {};

	let callIdx = 0;
	const captured: Array<{ credentialName: string; options: IHttpRequestOptions }> = [];
	const httpMock = jest.fn(async (credentialName: string, options: IHttpRequestOptions) => {
		// Snapshot args at call time (the node mutates the shared options object between calls).
		captured.push({ credentialName, options: structuredClone(options) });
		const response = responses[Math.min(callIdx, responses.length - 1)] as
			| { __throw?: unknown }
			| undefined;
		callIdx += 1;
		if (response && typeof response === 'object' && '__throw' in response) {
			throw (response as { __throw: unknown }).__throw;
		}
		return response;
	}) as HttpMock;
	httpMock.captured = captured;

	// Two real n8n signatures, selected by triggerStyle:
	//   execute:        getNodeParameter(name, itemIndex, fallback?, options?)  -> fallback at rest[1]
	//   poll/hook/webhook: getNodeParameter(name, fallback?, options?)          -> fallback at rest[0]
	// A missing param with no fallback throws (surfacing incomplete test setup) rather than
	// silently returning undefined.
	function getNodeParameter(name: string, ...rest: unknown[]): unknown {
		if (Object.prototype.hasOwnProperty.call(params, name)) {
			return params[name];
		}
		if (config.triggerStyle) {
			if (rest.length >= 1) return rest[0];
		} else if (rest.length >= 2) {
			return rest[1];
		}
		throw new Error(`mock getNodeParameter: no value or fallback provided for "${name}"`);
	}

	const node = {
		id: 'test-node',
		name: 'Tallyfy',
		type: 'n8n-nodes-tallyfy.tallyfy',
		typeVersion: 1,
		position: [0, 0] as [number, number],
		parameters: {},
	};

	const ctx = {
		getInputData: () => inputItems,
		getNodeParameter,
		getCredentials: async (_name: string) => credentials,
		continueOnFail: () => config.continueOnFail ?? false,
		getNode: () => node,
		getMode: () => config.mode ?? 'trigger',
		getWorkflowStaticData: (_type: string) => staticData,
		getNodeWebhookUrl: (_name: string) => config.webhookUrl,
		getBodyData: () => config.bodyData ?? {},
		helpers: {
			httpRequestWithAuthentication: httpMock,
			returnJsonArray,
		},
	};

	return { ctx, httpMock, staticData };
}

/** Convenience: the (snapshotted) options object from the Nth httpRequestWithAuthentication call. */
export function requestAt(httpMock: HttpMock, index: number): IHttpRequestOptions {
	return httpMock.captured[index].options;
}

/** Convenience: the credential name from the Nth httpRequestWithAuthentication call. */
export function credentialAt(httpMock: HttpMock, index: number): string {
	return httpMock.captured[index].credentialName;
}
