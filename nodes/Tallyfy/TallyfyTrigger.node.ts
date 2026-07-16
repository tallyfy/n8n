import type {
	IPollFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
} from 'n8n-workflow';

import { NodeConnectionType } from 'n8n-workflow';

// Cap the number of ids we remember per event so workflow static data stays small.
const SEEN_CAP = 5000;

export class TallyfyTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Tallyfy Trigger',
		name: 'tallyfyTrigger',
		icon: 'file:tallyfy.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts a workflow when Tallyfy events happen (polling, no webhooks)',
		defaults: {
			name: 'Tallyfy Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'tallyfyApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
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
				required: true,
			},

			// New Process Launched: optional template filter (that filter is honored by the API).
			{
				displayName: 'Template ID',
				name: 'checklistId',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
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
				description: 'Max number of newest items to fetch per poll (dedup is by id across polls)',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
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
