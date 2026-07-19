import type { INodeExecutionData, IWebhookResponseData } from 'n8n-workflow';
import { TallyfyTrigger } from '../../nodes/Tallyfy/TallyfyTrigger.node';
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
