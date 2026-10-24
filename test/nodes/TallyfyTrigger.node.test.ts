import type {
	INode,
	INodeExecutionData,
	INodeParameters,
	INodeProperties,
	INodeTypes,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeApiError, NodeHelpers, NodeOperationError, Workflow, cronNodeOptions } from 'n8n-workflow';
import { TallyfyTrigger } from '../../nodes/TallyfyTrigger/TallyfyTrigger.node';
import { createContextMock, requestAt } from '../helpers/mocks';

const BASE = 'https://go.tallyfy.com/api';
const ORG = 'ORG123';

describe('TallyfyTrigger - polling', () => {
	it('does not poll (and makes no request) in webhook mode', async () => {
		const { ctx, httpMock } = createContextMock({
			triggerStyle: true,
			params: { mode: 'webhook' },
		});
		const result = await new TallyfyTrigger().poll.call(ctx);
		expect(result).toBeNull();
		expect(httpMock).not.toHaveBeenCalled();
	});

	it('seeds on the first poll, then fires only for new items, deduping repeats by id', async () => {
		const { ctx, httpMock, staticData } = createContextMock({
			triggerStyle: true,
			mode: 'trigger',
			params: { mode: 'polling', event: 'processLaunched', limit: 50 },
			httpResponses: [
				{ data: [{ id: '1' }, { id: '2' }] }, // poll 1
				{ data: [{ id: '3' }, { id: '1' }, { id: '2' }] }, // poll 2: only '3' is new
				{ data: [{ id: '3' }, { id: '1' }, { id: '2' }] }, // poll 3: nothing new
			],
		});
		const trigger = new TallyfyTrigger();

		// Poll 1: activation must not replay the backlog -> returns null and seeds the seen-set.
		const first = await trigger.poll.call(ctx);
		expect(first).toBeNull();
		expect(staticData.seen_processLaunched_runs_all).toEqual(['1', '2']);
		// The list request is newest-first and org-scoped.
		const opts = requestAt(httpMock, 0);
		expect(opts.method).toBe('GET');
		expect(opts.url).toBe(`${BASE}/organizations/${ORG}/runs`);
		expect(opts.qs).toEqual({ sort: '-created_at', per_page: 50 });

		// Poll 2: only the genuinely new id fires; the two repeats are deduped out.
		const second = (await trigger.poll.call(ctx)) as INodeExecutionData[][];
		expect(second[0]).toHaveLength(1);
		expect(second[0][0].json).toEqual({ id: '3' });
		expect(staticData.seen_processLaunched_runs_all).toEqual(['3', '1', '2']);

		// Poll 3: nothing new -> null.
		expect(await trigger.poll.call(ctx)).toBeNull();
		expect(httpMock).toHaveBeenCalledTimes(3);
	});

	it('in manual (test) mode returns the newest items without persisting dedup state', async () => {
		const { ctx, httpMock, staticData } = createContextMock({
			triggerStyle: true,
			mode: 'manual',
			params: { mode: 'polling', event: 'processLaunched', limit: 50 },
			httpResponses: [{ data: [{ id: '1' }, { id: '2' }] }],
		});
		const result = (await new TallyfyTrigger().poll.call(ctx)) as INodeExecutionData[][];
		expect(result[0].map((i) => i.json)).toEqual([{ id: '1' }, { id: '2' }]);
		expect(httpMock).toHaveBeenCalledTimes(1);
		// No seen-set is written during a manual test run.
		expect(Object.keys(staticData)).toHaveLength(0);
	});
});

describe('TallyfyTrigger - instant webhook subscription lifecycle', () => {
	it('checkExists queries the watchers endpoint and adopts a matching subscription', async () => {
		const webhookUrl = 'https://n8n.example.com/webhook/abc';
		const { ctx, httpMock, staticData } = createContextMock({
			triggerStyle: true,
			params: { mode: 'webhook' },
			webhookUrl,
			httpResponses: [{ data: [{ id: 'W1', webhook: webhookUrl }] }],
		});
		const exists = await new TallyfyTrigger().webhookMethods.default.checkExists.call(ctx);
		expect(exists).toBe(true);
		const opts = requestAt(httpMock, 0);
		expect(opts.method).toBe('GET');
		expect(opts.url).toBe(`${BASE}/organizations/${ORG}/watchers`);
		expect(opts.qs).toEqual({ notification: 'webhook' });
		expect(staticData.watcherId).toBe('W1');
	});

	it('create resolves the user via /me then POSTs add-watcher (never a /webhooks endpoint)', async () => {
		const webhookUrl = 'https://n8n.example.com/webhook/abc';
		const { ctx, httpMock, staticData } = createContextMock({
			triggerStyle: true,
			params: { mode: 'webhook' },
			webhookUrl,
			httpResponses: [
				{ data: { id: 'USER1' } }, // GET /me
				{ data: { id: 'WATCH1' } }, // POST add-watcher
			],
		});
		const created = await new TallyfyTrigger().webhookMethods.default.create.call(ctx);
		expect(created).toBe(true);

		// First call resolves the current user.
		expect(requestAt(httpMock, 0)).toMatchObject({ method: 'GET', url: `${BASE}/me` });

		// Second call registers the watcher on the user-scoped add-watcher endpoint.
		const sub = requestAt(httpMock, 1);
		expect(sub.method).toBe('POST');
		expect(sub.url).toBe(`${BASE}/organizations/${ORG}/users/USER1/add-watcher`);
		expect(sub.body).toEqual({
			object_type: 'organization',
			object_id: ORG,
			notification_type: 'webhook',
			frequency: 'electric',
			webhook: webhookUrl,
		});

		expect(staticData.watcherId).toBe('WATCH1');
		// The verified contract has NO /webhooks subscription API; the node must not call one.
		expect(httpMock.mock.calls.every((c) => !c[1].url.includes('/webhooks'))).toBe(true);
	});

	it('delete removes the watcher via the remove-watcher endpoint and clears stored state', async () => {
		const { ctx, httpMock, staticData } = createContextMock({
			triggerStyle: true,
			params: { mode: 'webhook' },
			staticData: { watcherId: 'WATCH1' },
			httpResponses: [{}],
		});
		const deleted = await new TallyfyTrigger().webhookMethods.default.delete.call(ctx);
		expect(deleted).toBe(true);
		expect(requestAt(httpMock, 0)).toMatchObject({
			method: 'DELETE',
			url: `${BASE}/organizations/${ORG}/remove-watcher/WATCH1`,
		});
		expect(staticData.watcherId).toBeUndefined();
	});

	it('surfaces a clear admin-required error when Tallyfy returns 403 on subscribe', async () => {
		const { ctx } = createContextMock({
			triggerStyle: true,
			params: { mode: 'webhook' },
			webhookUrl: 'https://n8n.example.com/webhook/abc',
			httpResponses: [
				{ data: { id: 'USER1' } }, // GET /me
				{ __throw: { httpCode: '403' } }, // POST add-watcher -> forbidden
			],
		});
		await expect(
			new TallyfyTrigger().webhookMethods.default.create.call(ctx),
		).rejects.toThrow(/organization admin/i);
	});

	it('subscription methods are no-ops in polling mode (no request made)', async () => {
		const { ctx, httpMock } = createContextMock({
			triggerStyle: true,
			params: { mode: 'polling' },
		});
		const trigger = new TallyfyTrigger();
		expect(await trigger.webhookMethods.default.checkExists.call(ctx)).toBe(true);
		expect(await trigger.webhookMethods.default.create.call(ctx)).toBe(true);
		expect(await trigger.webhookMethods.default.delete.call(ctx)).toBe(true);
		expect(httpMock).not.toHaveBeenCalled();
	});
});

describe('TallyfyTrigger - instant webhook event filtering', () => {
	it('passes a selected event through as workflow data', async () => {
		const { ctx } = createContextMock({
			triggerStyle: true,
			params: { events: ['task.completed', 'process.launched'] },
			bodyData: { event: 'task.completed', task: { id: 'T1' } },
		});
		const result = (await new TallyfyTrigger().webhook.call(ctx)) as IWebhookResponseData;
		expect(result.webhookResponse).toBeUndefined();
		expect(result.workflowData![0][0].json).toEqual({ event: 'task.completed', task: { id: 'T1' } });
	});

	it('acknowledges but ignores an event the user did not select', async () => {
		const { ctx } = createContextMock({
			triggerStyle: true,
			params: { events: ['process.launched'] },
			bodyData: { event: 'task.completed' },
		});
		const result = (await new TallyfyTrigger().webhook.call(ctx)) as IWebhookResponseData;
		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toEqual({ received: true, ignored: 'task.completed' });
	});

	it('passes everything through when no events are selected', async () => {
		const { ctx } = createContextMock({
			triggerStyle: true,
			params: { events: [] },
			bodyData: { event: 'task.assigned' },
		});
		const result = (await new TallyfyTrigger().webhook.call(ctx)) as IWebhookResponseData;
		expect(result.workflowData).toBeDefined();
		expect(result.workflowData![0][0].json).toEqual({ event: 'task.assigned' });
	});
});

// tallyfy/n8n#4: n8n's verified-node rules forbid a webhook lifecycle method from swallowing an
// error silently or rethrowing a raw one. These lock what the fix changed and what it did not.
describe('TallyfyTrigger - lifecycle errors are logged or wrapped (#4)', () => {
	const NODE = {
		id: 'test-node',
		name: 'Tallyfy',
		type: 'n8n-nodes-tallyfy.tallyfy',
		typeVersion: 1,
		position: [0, 0] as [number, number],
		parameters: {},
	};

	it('checkExists still answers false when the watcher list fails, and now logs why', async () => {
		const { ctx } = createContextMock({
			triggerStyle: true,
			params: { mode: 'webhook' },
			webhookUrl: 'https://n8n.example.com/webhook/abc',
			httpResponses: [{ __throw: new Error('listing unavailable') }],
		});
		const exists = await new TallyfyTrigger().webhookMethods.default.checkExists.call(ctx);
		expect(exists).toBe(false);
		expect(ctx.logger.debug).toHaveBeenCalledTimes(1);
		expect(ctx.logger.debug.mock.calls[0][1]).toEqual({ error: 'listing unavailable' });
	});

	it('delete still never blocks deactivation, and now warns that the watcher may remain', async () => {
		const { ctx, staticData } = createContextMock({
			triggerStyle: true,
			params: { mode: 'webhook' },
			staticData: { watcherId: 'WATCH1' },
			httpResponses: [{ __throw: new Error('remove failed') }],
		});
		const deleted = await new TallyfyTrigger().webhookMethods.default.delete.call(ctx);
		expect(deleted).toBe(true);
		expect(staticData.watcherId).toBeUndefined();
		expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
		expect(ctx.logger.warn.mock.calls[0][0]).toContain('WATCH1');
	});

	it('create rethrows a non-403 API failure as the very same NodeApiError', async () => {
		const axiosError = Object.assign(new Error('Request failed with status code 500'), {
			isAxiosError: true,
			response: { status: 500, data: { message: 'Server error' } },
		});
		const apiError = new NodeApiError(NODE, axiosError as never);
		const { ctx } = createContextMock({
			triggerStyle: true,
			params: { mode: 'webhook' },
			webhookUrl: 'https://n8n.example.com/webhook/abc',
			httpResponses: [{ data: { id: 'USER1' } }, { __throw: apiError }],
		});
		await expect(new TallyfyTrigger().webhookMethods.default.create.call(ctx)).rejects.toBe(apiError);
	});

	it('create wraps any other failure in a NodeOperationError with the same message', async () => {
		const { ctx } = createContextMock({
			triggerStyle: true,
			params: { mode: 'webhook' },
			webhookUrl: 'https://n8n.example.com/webhook/abc',
			httpResponses: [{ data: { id: 'USER1' } }, { __throw: new Error('socket hang up') }],
		});
		const thrown = await new TallyfyTrigger()
			.webhookMethods.default.create.call(ctx)
			.then(() => undefined)
			.catch((e: unknown) => e as Error);
		expect(thrown).toBeInstanceOf(NodeOperationError);
		expect(thrown!.message).toBe('socket hang up');
	});

	it('is a trigger with one main output and the shared icon in both theme slots', () => {
		const description = new TallyfyTrigger().description;
		expect(description.inputs).toEqual([]);
		expect(description.outputs).toEqual(['main']);
		expect(description.icon).toEqual({
			light: 'file:../../icons/tallyfy.svg',
			dark: 'file:../../icons/tallyfy.svg',
		});
	});
});

// #59 (owner decision 2026-10-23): Instant is the default only for a trigger created on node
// version 2. These resolve the node's parameters with n8n-workflow's own getNodeParameters, the
// function n8n runs to fill in defaults when it loads a workflow and to strip them when it saves
// one, so they show what n8n itself does with each version, not what the description says.
describe('TallyfyTrigger - node versions and the Mode default (#59)', () => {
	const description = new TallyfyTrigger().description;
	const ALL_EVENTS = [
		'process.launched',
		'process.completed',
		'task.completed',
		'task.assigned',
		'task.comment_added',
		'task.issue_raised',
		'task.issue_resolved',
	];

	// What a node of this version runs with, after n8n fills in every default.
	function loaded(typeVersion: number, stored: INodeParameters = {}): INodeParameters {
		const params = NodeHelpers.getNodeParameters(
			description.properties,
			stored,
			true,
			false,
			{ typeVersion },
			description,
		);
		expect(params).not.toBeNull();
		return params as INodeParameters;
	}

	// What n8n writes to the saved workflow: only the values that differ from the defaults.
	function saved(typeVersion: number, values: INodeParameters): INodeParameters {
		const params = NodeHelpers.getNodeParameters(
			description.properties,
			values,
			false,
			false,
			{ typeVersion },
			description,
		);
		expect(params).not.toBeNull();
		return params as INodeParameters;
	}

	it('offers versions 1 and 2, and n8n creates a new trigger on version 2', () => {
		expect(description.version).toEqual([1, 2]);
		expect(description.defaultVersion).toBe(2);
	});

	it('version 1 still defaults to Polling and shows the polling fields', () => {
		const params = loaded(1);
		expect(params.mode).toBe('polling');
		expect(params.event).toBe('processLaunched');
		expect(params.events).toBeUndefined();
	});

	it('version 2 defaults to Instant and shows the webhook events', () => {
		const params = loaded(2);
		expect(params.mode).toBe('webhook');
		expect(params.events).toEqual(ALL_EVENTS);
		expect(params.event).toBeUndefined();
	});

	it('a trigger saved on Polling under version 1 stores no mode, and still loads as Polling', () => {
		// This is why version 1's default could not change: n8n stores nothing for a value that
		// equals the default, so the saved workflow cannot say it chose Polling.
		const stored = saved(1, { mode: 'polling', event: 'taskCompleted', limit: 50 });
		expect(stored).toEqual({ event: 'taskCompleted' });
		expect(loaded(1, stored).mode).toBe('polling');
	});

	it('a mode someone picked is stored and kept on either version', () => {
		const v1Instant = saved(1, { mode: 'webhook' });
		expect(v1Instant.mode).toBe('webhook');
		expect(loaded(1, v1Instant).mode).toBe('webhook');

		const v2Polling = saved(2, { mode: 'polling' });
		expect(v2Polling.mode).toBe('polling');
		expect(loaded(2, v2Polling).mode).toBe('polling');
	});

	it('the two Mode definitions differ only in their default and the version they show for', () => {
		const modes = description.properties.filter((p) => p.name === 'mode');
		expect(modes).toHaveLength(2);
		const strip = (mode: (typeof modes)[number]) => {
			const copy: Record<string, unknown> = { ...mode };
			delete copy.default;
			delete copy.displayOptions;
			return copy;
		};
		expect(strip(modes[0])).toEqual(strip(modes[1]));
		expect(modes.map((m) => m.default)).toEqual(['polling', 'webhook']);
	});

	it('no Mode description says the webhook backend is still rolling out', () => {
		const text = JSON.stringify(description.properties.filter((p) => p.name === 'mode'));
		expect(text).toMatch(/organization admin/);
		expect(text).not.toMatch(/rolling/i);
	});

	// If n8n ever hands the node no mode at all, the fallback must match the version's default.
	it('with no mode at all, a version 1 trigger polls and never subscribes', async () => {
		const { ctx, httpMock } = createContextMock({
			triggerStyle: true,
			typeVersion: 1,
			mode: 'trigger',
			params: { event: 'processLaunched', limit: 50 },
			webhookUrl: 'https://n8n.example.com/webhook/abc',
			httpResponses: [{ data: [{ id: '1' }] }],
		});
		const trigger = new TallyfyTrigger();
		expect(await trigger.webhookMethods.default.create.call(ctx)).toBe(true);
		expect(httpMock).not.toHaveBeenCalled();
		expect(await trigger.poll.call(ctx)).toBeNull();
		expect(httpMock).toHaveBeenCalledTimes(1);
		expect(requestAt(httpMock, 0).url).toBe(`${BASE}/organizations/${ORG}/runs`);
	});

	it('with no mode at all, a version 2 trigger subscribes and never polls', async () => {
		const { ctx, httpMock, staticData } = createContextMock({
			triggerStyle: true,
			typeVersion: 2,
			mode: 'trigger',
			params: {},
			webhookUrl: 'https://n8n.example.com/webhook/abc',
			httpResponses: [{ data: { id: 'USER1' } }, { data: { id: 'WATCH2' } }],
		});
		const trigger = new TallyfyTrigger();
		expect(await trigger.poll.call(ctx)).toBeNull();
		expect(httpMock).not.toHaveBeenCalled();
		expect(await trigger.webhookMethods.default.create.call(ctx)).toBe(true);
		expect(requestAt(httpMock, 1).url).toBe(`${BASE}/organizations/${ORG}/users/USER1/add-watcher`);
		expect(staticData.watcherId).toBe('WATCH2');
	});
});

// #59: api-v2 refuses an organization-wide watcher with more than one 403, and only one of them is
// about admin rights (WatchersAccess on api-v2 production). The others reach the user as Tallyfy's
// own sentence. Each body below is the exact text production sends.
describe('TallyfyTrigger - 403s on subscribe say what Tallyfy said (#59)', () => {
	const NODE = {
		id: 'test-node',
		name: 'Tallyfy Trigger',
		type: 'n8n-nodes-tallyfy.tallyfyTrigger',
		typeVersion: 2,
		position: [0, 0] as [number, number],
		parameters: {},
	};
	const NOT_FOUND = 'The object you want to watch does not exist.';
	const ADMIN = 'Access denied: organization-wide watchers require an admin role.';

	// The error n8n's httpRequestWithAuthentication throws for a non-2xx answer: a NodeApiError
	// built from the HTTP client's error, which it keeps as `cause`. api-v2 sends these 403
	// bodies as plain text, so `data` is the bare sentence.
	function forbidden(data: unknown): NodeApiError {
		const httpError = Object.assign(new Error('Request failed with status code 403'), {
			isAxiosError: true,
			response: { status: 403, data },
		});
		return new NodeApiError(NODE, httpError as never);
	}

	async function createFailure(thrown: unknown): Promise<NodeOperationError> {
		const { ctx } = createContextMock({
			triggerStyle: true,
			typeVersion: 2,
			params: { mode: 'webhook' },
			webhookUrl: 'https://n8n.example.com/webhook/abc',
			httpResponses: [{ data: { id: 'USER1' } }, { __throw: thrown }],
		});
		const error = await new TallyfyTrigger()
			.webhookMethods.default.create.call(ctx)
			.then(() => undefined)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeOperationError);
		return error as NodeOperationError;
	}

	it('passes "the object you want to watch does not exist" through, with no word about admins', async () => {
		const error = await createFailure(forbidden(NOT_FOUND));
		expect(error.message).toBe(`Tallyfy refused the webhook subscription: ${NOT_FOUND}`);
		expect(error.message).not.toMatch(/admin/i);
		expect(error.description).toMatch(/Organization ID/);
	});

	it('reads the sentence from a JSON body too', async () => {
		const error = await createFailure(forbidden({ message: 'Watcher does not exist' }));
		expect(error.message).toBe('Tallyfy refused the webhook subscription: Watcher does not exist');
	});

	it('reads the sentence when the transport error itself carries the body', async () => {
		const raw = Object.assign(new Error('Tallyfy API 403'), { statusCode: 403, response: NOT_FOUND });
		const error = await createFailure(raw);
		expect(error.message).toBe(`Tallyfy refused the webhook subscription: ${NOT_FOUND}`);
	});

	it('keeps the admin message for the admin refusal', async () => {
		const error = await createFailure(forbidden(ADMIN));
		expect(error.message).toBe(
			'Instant webhook triggers require a Tallyfy organization admin; switch Mode to Polling.',
		);
	});

	it('keeps the admin message when the 403 has no readable body', async () => {
		const html = '<html><body><h1>403 Forbidden</h1></body></html>';
		expect((await createFailure(forbidden(html))).message).toMatch(/organization admin/);
		expect((await createFailure(forbidden(''))).message).toMatch(/organization admin/);
	});
});

// #61. These evaluate the trigger's own expressions the way n8n does: a real n8n-workflow Workflow,
// whose constructor fills in each version's defaults, resolving them with
// workflow.expression.getSimpleParameterValue, the call n8n's WebhookService.getNodeWebhooks uses
// for a webhook's method and the editor uses for the canvas subtitle.
describe('TallyfyTrigger - what n8n resolves for each Mode and version (#61)', () => {
	const NODE_NAME = 'Tallyfy Trigger';

	function resolve(typeVersion: number, parameters: INodeParameters, value: unknown, fallback?: unknown): unknown {
		const trigger = new TallyfyTrigger();
		const nodeTypes = {
			getByName: () => trigger,
			getByNameAndVersion: () => trigger,
			getKnownTypes: () => ({}),
		} as unknown as INodeTypes;
		const node: INode = {
			id: 'node-1',
			name: NODE_NAME,
			type: 'n8n-nodes-tallyfy.tallyfyTrigger',
			typeVersion,
			position: [0, 0],
			parameters,
		};
		const workflow = new Workflow({ id: 'wf-1', nodes: [node], connections: {}, active: false, nodeTypes });
		const filled = workflow.getNode(NODE_NAME);
		expect(filled).not.toBeNull();
		return workflow.expression.getSimpleParameterValue(
			filled!,
			value as string,
			'internal',
			{},
			undefined,
			fallback as string,
		);
	}

	const description = new TallyfyTrigger().description;
	const httpMethod = description.webhooks![0].httpMethod;

	// n8n splits the resolved method on commas and skips every empty entry, so an empty string means
	// the node has no webhook (WebhookService.getNodeWebhooks in n8n 1.85.0 and 2.43.5).
	const registeredMethods = (method: unknown) =>
		String(method)
			.split(',')
			.filter((m) => m !== '')
			.map((m) => m.trim());

	it.each([
		[1, {}, ''],
		[1, { mode: 'polling' }, ''],
		[1, { mode: 'webhook' }, 'POST'],
		[2, {}, 'POST'],
		[2, { mode: 'webhook' }, 'POST'],
		[2, { mode: 'polling' }, ''],
	])('version %s with %j resolves the webhook method to "%s"', (typeVersion, stored, expected) => {
		const method = resolve(typeVersion, stored, httpMethod, 'GET');
		expect(method).toBe(expected);
		expect(registeredMethods(method)).toEqual(expected ? ['POST'] : []);
	});

	it('keeps the webhook path, so an Instant trigger registers where it did before', () => {
		expect(description.webhooks).toHaveLength(1);
		expect(description.webhooks![0]).toMatchObject({ name: 'default', path: 'webhook', responseMode: 'onReceived' });
	});

	const pollingEventOptions = () => {
		const event = description.properties.find((p) => p.name === 'event');
		expect(event?.options?.length).toBeGreaterThan(0);
		return event!.options as unknown as Array<{ name: string; value: string }>;
	};

	it.each([1, 2])('on version %s the Polling subtitle reads as each Event option\'s name', (typeVersion) => {
		for (const option of pollingEventOptions()) {
			expect(resolve(typeVersion, { mode: 'polling', event: option.value }, description.subtitle)).toBe(
				`Polling: ${option.name}`,
			);
		}
	});

	it('the subtitle follows each version\'s default Mode, and never shows a raw value', () => {
		expect(resolve(1, {}, description.subtitle)).toBe('Polling: New Process Launched');
		expect(resolve(2, {}, description.subtitle)).toBe('Instant webhook');
		expect(resolve(1, { mode: 'webhook' }, description.subtitle)).toBe('Instant webhook');
		expect(resolve(2, { mode: 'polling', event: 'taskAssigned' }, description.subtitle)).not.toMatch(/taskAssigned/);
	});
});

// #61. n8n's loader puts its own Poll Times property first on every polling node type, with no
// display options (applySpecialNodeParameters in n8n-core's directory loader), and activation reads
// it for every node with a poll() method, Instant included, with no fallback. This copies that
// property exactly, so the tests show what n8n does with it on this trigger.
describe('TallyfyTrigger - Poll Times stays, and a notice says it does nothing in Instant (#61)', () => {
	const description = new TallyfyTrigger().description;
	const n8nPollTimes: INodeProperties = {
		displayName: 'Poll Times',
		name: 'pollTimes',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, multipleValueButtonText: 'Add Poll Time' },
		default: { item: [{ mode: 'everyMinute' }] },
		description: 'Time at which polling should occur',
		placeholder: 'Add Poll Time',
		options: cronNodeOptions,
	};

	function loaded(properties: INodeProperties[], typeVersion: number, stored: INodeParameters): INodeParameters {
		const params = NodeHelpers.getNodeParameters(properties, stored, true, false, { typeVersion }, description);
		expect(params).not.toBeNull();
		return params as INodeParameters;
	}

	it('the trigger declares no Poll Times of its own, so n8n\'s stays the only one', () => {
		expect(description.properties.filter((p) => p.name === 'pollTimes')).toHaveLength(0);
	});

	it.each([
		[1, { mode: 'webhook' }],
		[2, {}],
	])('version %s in Instant (%j) still carries Poll Times, which activation reads', (typeVersion, stored) => {
		const params = loaded([n8nPollTimes, ...description.properties], typeVersion, stored);
		expect(params.mode).toBe('webhook');
		expect(params.pollTimes).toEqual({ item: [{ mode: 'everyMinute' }] });
	});

	it('hiding Poll Times in Instant mode would drop it, which is why it is not hidden', () => {
		const hidden: INodeProperties = { ...n8nPollTimes, displayOptions: { show: { mode: ['polling'] } } };
		expect(loaded([hidden, ...description.properties], 2, {}).pollTimes).toBeUndefined();
		expect(loaded([hidden, ...description.properties], 2, { mode: 'polling' }).pollTimes).toBeDefined();
	});

	it.each([
		[1, {}, false],
		[1, { mode: 'webhook' }, true],
		[2, {}, true],
		[2, { mode: 'polling' }, false],
	])('version %s with %j shows the Instant notice: %s', (typeVersion, stored, shown) => {
		const params = loaded(description.properties, typeVersion, stored);
		expect('instantModeNotice' in params).toBe(shown);
	});
});
