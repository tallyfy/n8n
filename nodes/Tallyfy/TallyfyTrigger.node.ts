import type {
	IPollFunctions,
	IHookFunctions,
	IWebhookFunctions,
	IWebhookResponseData,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

// Cap the number of ids we remember per event so workflow static data stays small.
const SEEN_CAP = 5000;

// The exact `event` strings the api-v2 webhook payloads carry (tallyfy/api-v2 #9561/#9562).
// Values are the wire format; the webhook() handler filters the inbound payload against these.
const WEBHOOK_EVENT_OPTIONS = [
	{
		name: 'Process Launched',
		value: 'process.launched',
		description: 'A new process (run) was launched',
	},
	{
		name: 'Process Completed',
		value: 'process.completed',
		description: 'A process (run) was completed',
	},
	{
		name: 'Task Completed',
		value: 'task.completed',
		description: 'A task was completed',
	},
	{
		name: 'Task Assigned',
		value: 'task.assigned',
		description: 'A task was assigned to a member',
	},
	{
		name: 'Comment Added',
		value: 'task.comment_added',
		description: 'A comment was added on a task',
	},
	{
		name: 'Issue Raised',
		value: 'task.issue_raised',
		description: 'An issue was raised on a task',
	},
	{
		name: 'Issue Resolved',
		value: 'task.issue_resolved',
		description: 'An issue was resolved on a task',
	},
];

// Shared request helper for the webhook lifecycle (subscribe / list / unsubscribe). Runs in
// the IHookFunctions context, which carries httpRequestWithAuthentication + getCredentials.
async function tallyfyApiRequest(
	this: IHookFunctions,
	method: 'GET' | 'POST' | 'DELETE',
	endpoint: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<IDataObject> {
	const credentials = await this.getCredentials('tallyfyApi');
	const baseUrl = (credentials.baseUrl as string) || 'https://go.tallyfy.com/api';
	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${endpoint}`,
		headers: {
			'Accept': 'application/json',
			'Content-Type': 'application/json',
		},
		qs,
		body: Object.keys(body).length ? body : undefined,
	};
	return (await this.helpers.httpRequestWithAuthentication.call(
		this,
		'tallyfyApi',
		options,
	)) as IDataObject;
}

// httpRequestWithAuthentication wraps a non-2xx response as a NodeApiError with `httpCode`
// set; raw transport errors carry statusCode / response.status. Check the reliable numeric
// fields rather than string-matching the message (which could false-positive on "403").
function isForbidden(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	const e = error as IDataObject;
	const response = (e.response as IDataObject) || {};
	const codes = [e.httpCode, e.statusCode, e.status, response.status, response.statusCode];
	return codes.some((code) => code !== undefined && String(code) === '403');
}

export class TallyfyTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Tallyfy Trigger',
		name: 'tallyfyTrigger',
		icon: 'file:tallyfy.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["mode"] === "webhook" ? "Instant webhook" : $parameter["event"]}}',
		description: 'Starts a workflow on Tallyfy events via an instant webhook subscription, or by polling as a fallback',
		defaults: {
			name: 'Tallyfy Trigger',
		},
		polling: true,
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'tallyfyApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Instant (Webhook)',
						value: 'webhook',
						description: 'Tallyfy pushes events to n8n in real time. Requires organization admin to subscribe.',
					},
					{
						name: 'Polling',
						value: 'polling',
						description: 'Poll Tallyfy periodically for new items. Works for non-admins and without a public URL.',
					},
				],
				default: 'webhook',
				description: 'How this trigger receives Tallyfy events. Instant webhooks need an org admin token; polling is the fallback.',
			},

			// ===== INSTANT WEBHOOK MODE =====
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				noDataExpression: true,
				displayOptions: {
					show: {
						mode: ['webhook'],
					},
				},
				options: WEBHOOK_EVENT_OPTIONS,
				default: [
					'process.launched',
					'process.completed',
					'task.completed',
					'task.assigned',
					'task.comment_added',
					'task.issue_raised',
					'task.issue_resolved',
				],
				required: true,
				description: 'Which Tallyfy events start the workflow. Other events delivered to the same webhook URL are ignored.',
			},

			// ===== POLLING MODE =====
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						mode: ['polling'],
					},
				},
				options: [
					{
						name: 'New Process Launched',
						value: 'processLaunched',
						description: 'Fires when a new process (run) is launched',
					},
					{
						name: 'Task Completed',
						value: 'taskCompleted',
						description: 'Fires when a task is completed',
					},
					{
						name: 'Task Assigned To Me',
						value: 'taskAssigned',
						description: 'Fires when a new active task is assigned to the connected user',
					},
					{
						name: 'Comment Or Issue Added',
						value: 'commentAdded',
						description: 'Fires when a comment or issue is added on a watched process (or template)',
					},
				],
				default: 'processLaunched',
			},

			// New Process Launched: optional template filter (that filter is honored by the API).
			{
				displayName: 'Template ID',
				name: 'checklistId',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						mode: ['polling'],
						event: ['processLaunched'],
					},
				},
				description: 'Optional: only fire for processes launched from this template (blueprint)',
			},

			// Comment Or Issue Added: there is no org-wide comment feed, so the trigger sweeps a
			// watched process (or all processes of a template) and dedups by thread id.
			{
				displayName: 'Watch',
				name: 'commentWatchType',
				type: 'options',
				options: [
					{
						name: 'A Single Process',
						value: 'run',
					},
					{
						name: 'All Processes Of A Template',
						value: 'template',
					},
				],
				default: 'run',
				displayOptions: {
					show: {
						mode: ['polling'],
						event: ['commentAdded'],
					},
				},
				description: 'Scope the comment sweep to keep each poll bounded',
			},
			{
				displayName: 'Process ID',
				name: 'watchRunId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						mode: ['polling'],
						event: ['commentAdded'],
						commentWatchType: ['run'],
					},
				},
				description: 'The process (run) whose tasks are swept for new comments and issues',
			},
			{
				displayName: 'Template ID',
				name: 'watchChecklistId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						mode: ['polling'],
						event: ['commentAdded'],
						commentWatchType: ['template'],
					},
				},
				description: 'Sweep the newest processes launched from this template for new comments and issues',
			},

			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 100,
				},
				default: 50,
				displayOptions: {
					show: {
						mode: ['polling'],
					},
				},
				description: 'Max number of results to return',
			},
		],
	};

	// Webhook subscription lifecycle: n8n calls these on workflow activation / deactivation.
	// In polling mode they are no-ops so a non-admin user can still run the node.
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const mode = this.getNodeParameter('mode', 'webhook') as string;
				if (mode !== 'webhook') return true; // polling mode: nothing subscribed

				const credentials = await this.getCredentials('tallyfyApi');
				const organizationId = credentials.organizationId as string;
				const webhookUrl = this.getNodeWebhookUrl('default');
				const staticData = this.getWorkflowStaticData('node') as IDataObject;

				try {
					// Verify against the org's webhook watchers (api-v2 #9561).
					const resp = await tallyfyApiRequest.call(
						this,
						'GET',
						`/organizations/${organizationId}/watchers`,
						{},
						{ notification: 'webhook' },
					);
					const watchers = (resp.data as IDataObject[]) ||
						(Array.isArray(resp) ? (resp as unknown as IDataObject[]) : []);
					const existing = watchers.find(
						(w) =>
							w &&
							(String(w.webhook) === String(webhookUrl) ||
								String(w.webhook_url) === String(webhookUrl) ||
								String(w.url) === String(webhookUrl)),
					);
					if (existing && existing.id !== undefined) {
						staticData.watcherId = existing.id;
						return true;
					}
				} catch {
					// Listing may be unavailable (endpoint not deployed, or the token lacks rights);
					// return false so create() runs and surfaces the authoritative admin/403 error.
					return false;
				}
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const mode = this.getNodeParameter('mode', 'webhook') as string;
				if (mode !== 'webhook') return true; // polling mode: no subscription

				const credentials = await this.getCredentials('tallyfyApi');
				const organizationId = credentials.organizationId as string;
				const webhookUrl = this.getNodeWebhookUrl('default');
				const staticData = this.getWorkflowStaticData('node') as IDataObject;

				if (!webhookUrl) {
					throw new NodeOperationError(
						this.getNode(),
						'n8n did not provide a webhook URL to register with Tallyfy.',
					);
				}

				// The add-watcher endpoint is user-scoped, so resolve the current user id from /me.
				const me = await tallyfyApiRequest.call(this, 'GET', '/me');
				const meData = (me.data as IDataObject) || me;
				const userId = meData && meData.id !== undefined ? String(meData.id) : '';
				if (!userId) {
					throw new NodeOperationError(
						this.getNode(),
						'Could not determine the current Tallyfy user id from /me.',
					);
				}

				try {
					const resp = await tallyfyApiRequest.call(
						this,
						'POST',
						`/organizations/${organizationId}/users/${userId}/add-watcher`,
						{
							object_type: 'organization',
							object_id: organizationId,
							notification_type: 'webhook',
							frequency: 'electric',
							webhook: webhookUrl,
						},
					);
					const watcher = (resp.data as IDataObject) || resp;
					if (watcher && watcher.id !== undefined) {
						staticData.watcherId = watcher.id;
					}
					return true;
				} catch (error) {
					if (isForbidden(error)) {
						throw new NodeOperationError(
							this.getNode(),
							'Instant webhook triggers require a Tallyfy organization admin; switch Mode to Polling.',
							{ level: 'warning' },
						);
					}
					throw error;
				}
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const mode = this.getNodeParameter('mode', 'webhook') as string;
				if (mode !== 'webhook') return true; // polling mode: nothing to remove

				const credentials = await this.getCredentials('tallyfyApi');
				const organizationId = credentials.organizationId as string;
				const staticData = this.getWorkflowStaticData('node') as IDataObject;
				const watcherId = staticData.watcherId;
				if (watcherId === undefined || watcherId === null) return true; // never subscribed

				try {
					await tallyfyApiRequest.call(
						this,
						'DELETE',
						`/organizations/${organizationId}/remove-watcher/${watcherId}`,
					);
				} catch {
					// Swallow so deactivation never blocks; the watcher may already be gone.
				}
				delete staticData.watcherId;
				return true;
			},
		},
	};

	// Instant webhook handler: Tallyfy POSTs each event here. Filter by the selected events and
	// pass the matching payload straight through as the workflow's trigger data.
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const bodyData = this.getBodyData();
		const selectedEvents = (this.getNodeParameter('events', []) as string[]) || [];
		const event = (bodyData.event as string) || '';

		// If the user narrowed the event set and this event is not selected, acknowledge the
		// delivery (200) without starting the workflow. An empty selection passes everything.
		if (event && selectedEvents.length > 0 && !selectedEvents.includes(event)) {
			return { webhookResponse: { received: true, ignored: event } };
		}

		return {
			workflowData: [this.helpers.returnJsonArray(bodyData)],
		};
	}

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		// Only poll in polling mode; in webhook mode Tallyfy pushes events instead.
		const mode = this.getNodeParameter('mode', 'webhook') as string;
		if (mode !== 'polling') return null;

		const credentials = await this.getCredentials('tallyfyApi');
		const baseUrl = (credentials.baseUrl as string) || 'https://go.tallyfy.com/api';
		const organizationId = credentials.organizationId as string;

		const event = this.getNodeParameter('event') as string;
		const limit = this.getNodeParameter('limit', 50) as number;
		const staticData = this.getWorkflowStaticData('node') as IDataObject;
		const isManual = this.getMode() === 'manual';

		const request = async (endpoint: string, qs: IDataObject): Promise<IDataObject> => {
			const options: IHttpRequestOptions = {
				method: 'GET',
				url: `${baseUrl}${endpoint}`,
				headers: {
					'Accept': 'application/json',
				},
				qs,
			};
			return (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'tallyfyApi',
				options,
			)) as IDataObject;
		};

		let items: IDataObject[] = [];
		let dedupScope = '';

		if (event === 'processLaunched') {
			// Poll newest-first; sort=-created_at is honored by the API.
			const checklistId = this.getNodeParameter('checklistId', '') as string;
			const qs: IDataObject = { sort: '-created_at', per_page: limit };
			if (checklistId) qs.checklist_id = checklistId;
			const resp = await request(`/organizations/${organizationId}/runs`, qs);
			items = (resp.data as IDataObject[]) || [];
			dedupScope = `runs_${checklistId || 'all'}`;
		} else if (event === 'taskCompleted') {
			// status=completed is a real filter; sort by completed_at client-side (server sort unreliable).
			const resp = await request(`/organizations/${organizationId}/tasks`, {
				status: 'completed',
				per_page: limit,
			});
			items = (resp.data as IDataObject[]) || [];
			items.sort((a, b) =>
				String(b.completed_at || '').localeCompare(String(a.completed_at || '')),
			);
			dedupScope = 'tasks_completed';
		} else if (event === 'taskAssigned') {
			const resp = await request(`/organizations/${organizationId}/tasks`, {
				assignee: 'me',
				status: 'active',
				per_page: limit,
			});
			items = (resp.data as IDataObject[]) || [];
			dedupScope = 'tasks_assigned';
		} else if (event === 'commentAdded') {
			// Comments live on tasks (task.threads.data[]); there is no org-wide feed.
			const watchType = this.getNodeParameter('commentWatchType') as string;
			let runIds: string[] = [];
			if (watchType === 'run') {
				runIds = [this.getNodeParameter('watchRunId') as string];
			} else {
				const checklistId = this.getNodeParameter('watchChecklistId') as string;
				const runsResp = await request(`/organizations/${organizationId}/runs`, {
					checklist_id: checklistId,
					sort: '-created_at',
					per_page: limit,
				});
				runIds = ((runsResp.data as IDataObject[]) || [])
					.map((r) => r.id as string)
					.filter(Boolean);
			}

			const threads: IDataObject[] = [];
			for (const runId of runIds) {
				const tasksResp = await request(
					`/organizations/${organizationId}/runs/${runId}/tasks`,
					{ with: 'threads', per_page: 100 },
				);
				const tasks = (tasksResp.data as IDataObject[]) || [];
				for (const task of tasks) {
					const wrapper = (task.threads as IDataObject) || {};
					const taskThreads = (wrapper.data as IDataObject[]) || [];
					for (const thread of taskThreads) {
						threads.push({ ...thread, run_id: runId, task_id: task.id });
					}
				}
			}
			items = threads;
			dedupScope = `comments_${watchType}`;
		}

		// De-duplicate client-side by object id (the API ignores every *_since date cursor).
		const seenKey = `seen_${event}_${dedupScope}`;
		const seen = (staticData[seenKey] as string[]) || [];
		const seenSet = new Set(seen);

		const fresh = items.filter(
			(item) => item && item.id !== undefined && !seenSet.has(String(item.id)),
		);

		// Manual (test) execution: show the newest items without persisting state.
		if (isManual) {
			if (!items.length) return null;
			return [this.helpers.returnJsonArray(items.slice(0, limit))];
		}

		// First poll: seed the seen-set so activation does not replay the whole backlog.
		if (!seen.length) {
			const ids = items.map((item) => String(item.id)).filter((id) => id !== 'undefined');
			staticData[seenKey] = ids.slice(0, SEEN_CAP);
			return null;
		}

		if (!fresh.length) return null;

		const newIds = fresh.map((item) => String(item.id));
		staticData[seenKey] = [...newIds, ...seen].slice(0, SEEN_CAP);
		return [this.helpers.returnJsonArray(fresh)];
	}
}
