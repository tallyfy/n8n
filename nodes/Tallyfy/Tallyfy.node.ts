import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';

/**
 * Weekdays as api-v2 numbers them in a schedule: 1 is Monday and 7 is Sunday, in both
 * `day_of_week` (api-v2 production) and `days_of_week` (api-v2#8974). Kept in week order
 * rather than alphabetical: n8n's sorting rule skips a list whose values are numbers.
 */
const WEEKDAY_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Monday', value: 1 },
	{ name: 'Tuesday', value: 2 },
	{ name: 'Wednesday', value: 3 },
	{ name: 'Thursday', value: 4 },
	{ name: 'Friday', value: 5 },
	{ name: 'Saturday', value: 6 },
	{ name: 'Sunday', value: 7 },
];

/** The api-v2 `job_key` behind each Job Type option (GET recurring-job-types). */
const SCHEDULED_JOB_KEYS: Record<string, string> = {
	createTask: 'create-task',
	launchProcess: 'launch-process',
};

/** Scheduled Job operations that name one job, and so can meet the hidden-job 404. */
const SCHEDULED_JOB_ID_OPERATIONS = ['get', 'getHistory', 'update', 'pause', 'resume', 'delete'];

/**
 * The schedule keys a job is saved with. api-v2 production stores one weekday in
 * `day_of_week`; api-v2#8974 replaces it with the list `days_of_week`. Each API drops the key
 * it does not know (RecurringSchedule::$fields with Arr::only), so a job read from either is
 * sent back with whichever it carries.
 */
const SCHEDULE_KEYS = [
	'recurring_type',
	'interval',
	'adjust_to_nearest_date',
	'start_time',
	'day_of_week',
	'days_of_week',
	'week_of_month',
	'day_of_month',
	'month_of_year',
];

/**
 * The message for a 404 on a request that names one scheduled job. api-v2 answers a job the
 * caller may not manage with the same 404 as a job that does not exist (tallyfy/api-v2#10896),
 * so the node cannot tell them apart and says both.
 */
export function scheduledJobNotFoundMessage(jobId: string): string {
	return `Scheduled job ${jobId} was not found. Either it does not exist in this organization, or the connected user may not manage it: a member sees only the jobs they created and the launch jobs for blueprints they may launch, and an admin sees every job.`;
}

/** The HTTP status an error carries, wherever the wrapper put it, or undefined. */
function httpStatusOf(error: unknown): number | undefined {
	if (typeof error !== 'object' || error === null) return undefined;
	const err = error as Record<string, unknown>;
	const response = err.response as Record<string, unknown> | undefined;
	for (const candidate of [err.httpCode, err.statusCode, err.status, response?.status, response?.statusCode]) {
		const status = Number(candidate);
		if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
	}
	return undefined;
}

/**
 * A schedule day as the API takes it, YYYY-MM-DD, from an n8n date value. n8n hands a date
 * parameter over as a string such as 2026-10-24T00:00:00, and an expression may give a Date
 * or a Luxon DateTime. Only the calendar day written in the value is kept; a time or offset
 * after it is dropped, because the API reads the day together with the schedule's start time.
 * Returns undefined for anything that does not name a day.
 */
export function toScheduleDay(value: unknown): string | undefined {
	let text: string | undefined;
	if (typeof value === 'string') {
		text = value.trim();
	} else if (value instanceof Date) {
		text = Number.isNaN(value.getTime()) ? undefined : value.toISOString();
	} else if (value && typeof (value as { toISODate?: unknown }).toISODate === 'function') {
		const iso = (value as { toISODate: () => string | null }).toISODate();
		text = iso ?? undefined;
	}
	const match = text ? /^(\d{4})-(\d{2})-(\d{2})/.exec(text) : null;
	if (!match) return undefined;
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
	return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * A start time as the API takes it, 24 hour HH:mm (`date_format:H:i`, which refuses an
 * unpadded hour and refuses seconds). Accepts 9:00, 09:00 and 09:00:00. Returns undefined for
 * anything else.
 */
export function toScheduleTime(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
	if (!match) return undefined;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23 || minute > 59) return undefined;
	return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

/**
 * Put weekdays on a schedule so either API reads them: the list in `days_of_week`
 * (api-v2#8974) and the earliest day in `day_of_week` (api-v2 production, which stores one).
 * Each API ignores the key it does not know.
 */
function setScheduleWeekdays(schedule: IDataObject, days: number[]): void {
	const sorted = [...new Set(days)].sort((a, b) => a - b);
	schedule.days_of_week = sorted;
	schedule.day_of_week = sorted[0];
}

/**
 * The whole job as an update must send it, built from the job as GET returns it.
 *
 * PUT recurring-jobs/{id} requires name, start_date, data, recurring_job_type_id and the
 * schedule's recurring_type and start_time (UpdateRecurringJobRequest), so a change to one
 * field still sends the rest. What the read returns is not always what the write accepts, so
 * this adjusts it the way the next-gen client does:
 * - the stored status goes back unchanged, which the API always accepts, and which a finished
 *   (`completed`) job must send to be renamed at all;
 * - a null value is left out, because a rule such as `integer` or `date` refuses null, and a
 *   key left out keeps its stored value;
 * - start_date and end_date go back as the day, YYYY-MM-DD;
 * - start_time is stored with seconds and goes back as HH:mm;
 * - data.created_by is the server's own stamp, which it ignores on update, so it is not sent.
 */
function scheduledJobUpdateBody(stored: IDataObject): IDataObject {
	const body: IDataObject = {};
	for (const key of ['name', 'description', 'max_occurrences', 'status', 'recurring_job_type_id']) {
		if (stored[key] !== null && stored[key] !== undefined) body[key] = stored[key];
	}
	for (const key of ['start_date', 'end_date']) {
		const day = toScheduleDay(stored[key]);
		if (day) body[key] = day;
	}
	const data: IDataObject = { ...((stored.data as IDataObject) || {}) };
	delete data.created_by;
	body.data = data;
	const storedSchedule = (stored.schedule as IDataObject) || {};
	const schedule: IDataObject = {};
	for (const key of SCHEDULE_KEYS) {
		if (storedSchedule[key] !== null && storedSchedule[key] !== undefined) schedule[key] = storedSchedule[key];
	}
	const time = toScheduleTime(schedule.start_time);
	if (time) schedule.start_time = time;
	body.schedule = schedule;
	return body;
}

/**
 * Tallyfy's allocated-seats billing (api-v2 #9206) refuses a seat-consuming
 * action with HTTP 409 and a NESTED body:
 *
 *   {"error": {"code": "SEAT_POOL_EXHAUSTED",
 *              "message": "...committed full seat limit...",
 *              "details": {"pool_type": "full"}}}
 *
 * Three of this node's operations can hit it: User > Invite, User > Update Role
 * and User > Enable.
 *
 * What the operator loses without this is narrower than it looks, and worth
 * stating precisely. n8n's own NodeApiError already lifts the server message
 * into `description`, so the reason IS visible today. What is lost is
 * `details.pool_type`, and that is the whole difference between buying light
 * seats and buying full seats.
 *
 * WHERE THE ENVELOPE ACTUALLY IS. This matters more than it should. The node
 * calls httpRequestWithAuthentication, which is axios-backed and rethrows as
 * `new NodeApiError(node, axiosError)`. Two consequences, both measured against
 * the installed n8n-workflow rather than assumed:
 *
 *   1. NodeApiError declares a bare `cause` class field, so under ES2022 field
 *      semantics it is reset to undefined after super() returns. Walking
 *      `cause` off a NodeApiError therefore reaches nothing. The walk below is
 *      kept only for wrappers that preserve it.
 *   2. The envelope survives at `err.context.data`, and axios puts it at
 *      `response.data`, NOT `response.body`. `body` is the legacy
 *      `this.helpers.request` convention, which this node does not use.
 *
 * KNOWN LIMIT, do not try to fix it by adding candidates. If axios hands back
 * `response.data` as a STRING rather than a parsed object, NodeApiError drops
 * it: measured, the envelope then survives nowhere on the error, `context.data`
 * is undefined and `description` falls back to "Request failed with status
 * code 409". Nothing downstream can recover data that was never attached. This
 * does not arise from api-v2 itself, which returns a JsonResponse and so always
 * carries an application/json content-type for axios to parse; it would take an
 * intermediary rewriting the content-type, and in that case the envelope is
 * already lost before this node sees it.
 *
 * Returns a readable message, or undefined for anything that is not this error
 * (every other failure keeps n8n's own handling untouched).
 */
export function seatPoolExhaustedMessage(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null) return undefined;

	// The body lands in a different place depending on the wrapper, so check
	// each known location rather than guessing one. The depth bound is what
	// guarantees termination: a self-referential `cause` is real, and an
	// unbounded walk of one would hang the workflow, so never relax this into
	// `while (node)`.
	const candidates: unknown[] = [];
	let node: unknown = error;
	for (let depth = 0; depth < 4 && typeof node === 'object' && node !== null; depth++) {
		const obj = node as Record<string, unknown>;
		const response = obj.response as Record<string, unknown> | undefined;
		const context = obj.context as Record<string, unknown> | undefined;
		candidates.push(
			// `node` itself, so an already-unwrapped envelope works too.
			obj,
			context?.data, // where NodeApiError actually keeps it
			response?.data, // axios
			response?.body, // legacy this.helpers.request
			obj.error,
			obj.body,
		);
		node = obj.cause;
	}

	for (const candidate of candidates) {
		const envelope = extractSeatPoolEnvelope(candidate);
		if (envelope) return renderSeatPoolMessage(envelope);
	}
	return undefined;
}

function extractSeatPoolEnvelope(candidate: unknown): Record<string, unknown> | undefined {
	// n8n stringifies some bodies before attaching them.
	let value = candidate;
	if (typeof value === 'string') {
		// Fast path only. The code check below is what actually rejects, so this
		// has no behaviour of its own to test; it just avoids parsing every
		// unrelated string body the walk collects.
		if (!value.includes('SEAT_POOL_EXHAUSTED')) return undefined;
		try {
			value = JSON.parse(value);
		} catch {
			return undefined;
		}
	}
	if (typeof value !== 'object' || value === null) return undefined;

	// Accept both the whole response body and an already-unwrapped envelope, so
	// this keeps working if a caller hands us either one.
	const outer = value as Record<string, unknown>;
	const inner = typeof outer.error === 'object' && outer.error !== null ? (outer.error as Record<string, unknown>) : outer;
	return inner.code === 'SEAT_POOL_EXHAUSTED' ? inner : undefined;
}

function renderSeatPoolMessage(envelope: Record<string, unknown>): string {
	const details = (typeof envelope.details === 'object' && envelope.details !== null
		? envelope.details
		: {}) as Record<string, unknown>;
	// pool_type is documented as always present, but "no undefined seats left"
	// would be worse than a slightly vaguer sentence.
	const poolType = typeof details.pool_type === 'string' && details.pool_type ? details.pool_type : 'available';
	const reason = typeof envelope.message === 'string' && envelope.message
		? envelope.message
		: 'The organization has reached its committed seat limit.';

	return `${reason} No ${poolType} seats are left in the organization's committed pool. A Tallyfy admin can purchase more seats under Settings > Billing, or free one by disabling an existing ${poolType} member.`;
}

export class Tallyfy implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Tallyfy',
		name: 'tallyfy',
		// The same file fills both theme slots on purpose: the icon is a solid tile that reads on
		// light and dark canvases alike, so there is no separate dark artwork to point at.
		icon: { light: 'file:../../icons/tallyfy.svg', dark: 'file:../../icons/tallyfy.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with Tallyfy workflow automation platform',
		defaults: {
			name: 'Tallyfy',
		},
		// Lets an n8n AI Agent call this node as a tool. The old
		// N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE environment switch no longer exists, so this flag
		// is the only way a community node becomes available to the agent.
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'tallyfyApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Blueprint',
						value: 'blueprint',
						description: 'Process templates',
					},
					{
						name: 'Comment',
						value: 'comment',
						description: 'Comments on tasks or processes',
					},
					{
						name: 'Folder',
						value: 'folder',
						description: 'Folder management',
					},
					{
						name: 'Form Field',
						value: 'formField',
						description: 'Form fields in tasks',
					},
					{
						name: 'Group',
						value: 'group',
						description: 'Group management',
					},
					{
						name: 'Guest',
						value: 'guest',
						description: 'Guest management',
					},
					{
						name: 'ID Finder',
						value: 'idFinder',
						description: 'Find IDs for various resources',
					},
					{
						name: 'Process',
						value: 'process',
						description: 'Process instances (runs)',
					},
					{
						name: 'Scheduled Job',
						value: 'scheduledJob',
						description: 'Once and recurring jobs that create a task or launch a process',
					},
					{
						name: 'Search',
						value: 'search',
						description: 'Search across Tallyfy',
					},
					{
						name: 'Tag',
						value: 'tag',
						description: 'Tag management',
					},
					{
						name: 'Task',
						value: 'task',
						description: 'Individual tasks',
					},
					{
						name: 'User',
						value: 'user',
						description: 'User management',
					},
				],
				default: 'task',
				required: true,
			},

			// ===== BLUEPRINT OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['blueprint'],
					},
				},
				options: [
					{
						name: 'Clone',
						value: 'clone',
						description: 'Clone a blueprint (template)',
						action: 'Clone a blueprint',
					},
					{
						name: 'Create',
						value: 'create',
						description: 'Create a blueprint',
						action: 'Create a blueprint',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a blueprint',
						action: 'Delete a blueprint',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a blueprint',
						action: 'Get a blueprint',
					},
					{
						name: 'Get Kickoff Fields',
						value: 'getKickoffFields',
						description: 'Get a template kickoff (prerun) fields',
						action: 'Get kickoff fields',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many blueprints',
						action: 'Get many blueprints',
					},
					{
						name: 'List Steps',
						value: 'listSteps',
						description: 'List all steps of a template',
						action: 'List template steps',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a blueprint',
						action: 'Update a blueprint',
					},
				],
				default: 'getAll',
			},

			// ===== PROCESS OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['process'],
					},
				},
				options: [
					{
						name: 'Archive',
						value: 'archive',
						description: 'Archive a process (soft delete)',
						action: 'Archive a process',
					},
					{
						name: 'Complete Kickoff Form',
						value: 'completeKickoffForm',
						description: 'Mark a process kickoff form as submitted',
						action: 'Complete kickoff form',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a process',
						action: 'Get a process',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many processes',
						action: 'Get many processes',
					},
					{
						name: 'Get Tasks',
						value: 'getTasks',
						description: 'Get all tasks in a process',
						action: 'Get process tasks',
					},
					{
						name: 'Launch',
						value: 'launch',
						description: 'Launch a new process from a blueprint',
						action: 'Launch a process',
					},
					{
						name: 'Reactivate',
						value: 'reactivate',
						description: 'Reactivate an archived process',
						action: 'Reactivate a process',
					},
					{
						name: 'Reopen Kickoff Form',
						value: 'reopenKickoffForm',
						description: 'Reopen a submitted kickoff form for edits',
						action: 'Reopen kickoff form',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a process',
						action: 'Update a process',
					},
				],
				default: 'launch',
			},

			// ===== TASK OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['task'],
					},
				},
				options: [
					{
						name: 'Clone',
						value: 'clone',
						description: 'Clone a task',
						action: 'Clone a task',
					},
					{
						name: 'Complete',
						value: 'complete',
						description: 'Complete a task',
						action: 'Complete a task',
					},
					{
						name: 'Create One-Off',
						value: 'createOneOff',
						description: 'Create a standalone task with all properties',
						action: 'Create a standalone task',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a task',
						action: 'Delete a task',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a task',
						action: 'Get a task',
					},
					{
						name: 'Get Guest Tasks',
						value: 'getGuestTasks',
						description: 'List tasks assigned to a guest',
						action: 'Get guest tasks',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many tasks',
						action: 'Get many tasks',
					},
					{
						name: 'Get My Tasks',
						value: 'getMyTasks',
						description: 'List tasks assigned to the connected user',
						action: 'Get my tasks',
					},
					{
						name: 'Get Process Task',
						value: 'getProcessTask',
						description: 'Get one task inside a process',
						action: 'Get process task',
					},
					{
						name: 'Get User Tasks',
						value: 'getUserTasks',
						description: 'List tasks assigned to a specific member',
						action: 'Get user tasks',
					},
					{
						name: 'Reopen',
						value: 'reopen',
						description: 'Reopen a completed task',
						action: 'Reopen a task',
					},
					{
						name: 'Update Process Task',
						value: 'updateProcessTask',
						description: 'Update a task inside a process (title, deadline, owners, form values, status)',
						action: 'Update process task',
					},
					{
						name: 'Update Properties',
						value: 'updateProperties',
						description: 'Update task properties (title, deadline, assignees, etc.)',
						action: 'Update task properties',
					},
				],
				default: 'complete',
			},

			// ===== FORM FIELD OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['formField'],
					},
				},
				options: [
					{
						name: 'Add Field',
						value: 'addField',
						description: 'Add a form field to a template step',
						action: 'Add form field',
					},
					{
						name: 'Add Kickoff Field',
						value: 'addKickoffField',
						description: 'Add a field to the template kickoff form',
						action: 'Add kickoff field',
					},
					{
						name: 'Delete Field',
						value: 'deleteField',
						description: 'Delete a form field from a template step',
						action: 'Delete form field',
					},
					{
						name: 'Delete Kickoff Field',
						value: 'deleteKickoffField',
						description: 'Delete a kickoff field',
						action: 'Delete kickoff field',
					},
					{
						name: 'Get Dropdown Options',
						value: 'getDropdownOptions',
						description: 'Get the options of a choice field',
						action: 'Get dropdown options',
					},
					{
						name: 'Get Fields',
						value: 'getFields',
						description: 'Get all form fields for a task or process',
						action: 'Get form fields',
					},
					{
						name: 'Move Field',
						value: 'moveField',
						description: 'Move a form field to another step',
						action: 'Move form field',
					},
					{
						name: 'Reorder Kickoff Fields',
						value: 'reorderKickoffField',
						description: 'Reorder the template kickoff fields',
						action: 'Reorder kickoff fields',
					},
					{
						name: 'Update Dropdown Options',
						value: 'updateDropdownOptions',
						description: 'Replace the options of a choice field',
						action: 'Update dropdown options',
					},
					{
						name: 'Update Field',
						value: 'updateField',
						description: 'Update a form field on a template step',
						action: 'Update form field',
					},
					{
						name: 'Update Kickoff Field',
						value: 'updateKickoffField',
						description: 'Update a kickoff field',
						action: 'Update kickoff field',
					},
					{
						name: 'Update Value',
						value: 'updateValue',
						description: 'Update a form field value in a task. An administrator may write a kick-off field at any time, and a task field while the task is not completed or auto-skipped. While the process is not complete, the process owner or anyone assigned to one of its live tasks may write a kick-off field. While the task is active, its assignee, directly or through a group, may write a task field. Anyone else gets 403. A value on an archived process or task cannot be written (422). Returns the updated value: the data object of the response.',
						action: 'Update form field value',
					},
				],
				default: 'updateValue',
			},

			// ===== COMMENT OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['comment'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Add a comment to a task',
						action: 'Create a comment',
					},
					{
						name: 'Create Bot Comment',
						value: 'createBot',
						description: 'Add a bot comment (no notifications)',
						action: 'Create bot comment',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a comment',
						action: 'Delete a comment',
					},
					{
						name: 'List',
						value: 'list',
						description: 'List all comments and issues on a process task',
						action: 'List task comments',
					},
					{
						name: 'Report Problem',
						value: 'reportProblem',
						description: 'Report a problem/blocker on a task',
						action: 'Report problem',
					},
					{
						name: 'Resolve Issue',
						value: 'resolveIssue',
						description: 'Mark an issue as resolved',
						action: 'Resolve issue',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a comment',
						action: 'Update a comment',
					},
				],
				default: 'create',
			},

			// ===== USER OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['user'],
					},
				},
				options: [
					{
						name: 'Convert to Guest',
						value: 'convertToGuest',
						description: 'Convert member to guest',
						action: 'Convert to guest',
					},
					{
						name: 'Disable',
						value: 'disable',
						description: 'Disable a user',
						action: 'Disable user',
					},
					{
						name: 'Enable',
						value: 'enable',
						description: 'Enable a user',
						action: 'Enable user',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a user',
						action: 'Get a user',
					},
					{
						name: 'Get Current',
						value: 'getCurrent',
						description: 'Get current authenticated user',
						action: 'Get current user',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many users',
						action: 'Get many users',
					},
					{
						name: 'Get Organization',
						value: 'getOrganization',
						description: 'Get the organization details',
						action: 'Get organization',
					},
					{
						name: 'Invite',
						value: 'invite',
						description: 'Invite a user to organization',
						action: 'Invite a user',
					},
					{
						name: 'Update Role',
						value: 'updateRole',
						description: 'Update user role',
						action: 'Update user role',
					},
				],
				default: 'getAll',
			},

			// ===== GUEST OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['guest'],
					},
				},
				options: [
					{
						name: 'Convert to Member',
						value: 'convertToMember',
						description: 'Convert guest to member',
						action: 'Convert to member',
					},
					{
						name: 'Create',
						value: 'create',
						description: 'Create a guest',
						action: 'Create a guest',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a guest',
						action: 'Delete a guest',
					},
					{
						name: 'Disable',
						value: 'disable',
						description: 'Disable a guest (blocks org access)',
						action: 'Disable a guest',
					},
					{
						name: 'Enable',
						value: 'enable',
						description: 'Re-enable a disabled guest',
						action: 'Enable a guest',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a guest',
						action: 'Get a guest',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many guests',
						action: 'Get many guests',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update guest information',
						action: 'Update a guest',
					},
				],
				default: 'create',
			},

			// ===== GROUP OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['group'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create a group',
						action: 'Create a group',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a group',
						action: 'Delete a group',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a group',
						action: 'Get a group',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many groups',
						action: 'Get many groups',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update group (including members)',
						action: 'Update a group',
					},
				],
				default: 'create',
			},

			// ===== SEARCH OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['search'],
					},
				},
				options: [
					{
						name: 'Global Search',
						value: 'global',
						description: 'Search across all Tallyfy resources',
						action: 'Global search',
					},
					{
						name: 'Search Blueprints',
						value: 'blueprints',
						description: 'Search for blueprints',
						action: 'Search blueprints',
					},
					{
						name: 'Search Processes',
						value: 'processes',
						description: 'Search for processes',
						action: 'Search processes',
					},
					{
						name: 'Search Snippets',
						value: 'snippets',
						description: 'Search for text snippets',
						action: 'Search snippets',
					},
					{
						name: 'Search Tasks',
						value: 'tasks',
						description: 'Search for tasks',
						action: 'Search tasks',
					},
				],
				default: 'global',
			},

			// ===== ID FINDER OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['idFinder'],
					},
				},
				options: [
					{
						name: 'Find Blueprint ID',
						value: 'findBlueprintId',
						description: 'Find blueprint ID by name or search',
						action: 'Find blueprint ID',
					},
					{
						name: 'Find Form Field ID',
						value: 'findFormFieldId',
						description: 'Find form field ID in a task or process',
						action: 'Find form field ID',
					},
					{
						name: 'Find Group ID',
						value: 'findGroupId',
						description: 'Find group ID by name',
						action: 'Find group ID',
					},
					{
						name: 'Find Process ID',
						value: 'findProcessId',
						description: 'Find process ID by name or search',
						action: 'Find process ID',
					},
					{
						name: 'Find Task ID',
						value: 'findTaskId',
						description: 'Find task ID by name or search',
						action: 'Find task ID',
					},
					{
						name: 'Find User ID',
						value: 'findUserId',
						description: 'Find user ID by email or name',
						action: 'Find user ID',
					},
				],
				default: 'findProcessId',
			},

			// ===== SCHEDULED JOB OPERATIONS =====
			// api-v2 calls these recurring jobs (routes/api.php, `recurring-jobs`); the next-gen client
			// shows them as Once and Recurring scheduled jobs. There is no pause or resume route: both
			// are an update of `status`, so Pause and Resume read the job and send it back.
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Schedule a task or a process launch, once or on a repeating schedule',
						action: 'Create a scheduled job',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a scheduled job',
						action: 'Delete a scheduled job',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a scheduled job',
						action: 'Get a scheduled job',
					},
					{
						name: 'Get History',
						value: 'getHistory',
						description: 'List each time a scheduled job ran and whether it succeeded',
						action: 'Get scheduled job history',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many scheduled jobs',
						action: 'Get many scheduled jobs',
					},
					{
						name: 'Pause',
						value: 'pause',
						description: 'Pause a scheduled job so it stops running',
						action: 'Pause a scheduled job',
					},
					{
						name: 'Resume',
						value: 'resume',
						description: 'Resume a paused scheduled job',
						action: 'Resume a scheduled job',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Change a scheduled job',
						action: 'Update a scheduled job',
					},
				],
				default: 'getAll',
			},

			// ================================
			// FIELD DEFINITIONS FOR EACH RESOURCE
			// ================================

			// ===== BLUEPRINT FIELDS =====
			{
				displayName: 'Blueprint ID',
				name: 'blueprintId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['blueprint'],
						operation: ['get', 'update', 'delete', 'clone', 'getKickoffFields', 'listSteps'],
					},
				},
				description: 'The ID of the blueprint',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['blueprint'],
						operation: ['create', 'update'],
					},
				},
				description: 'The title of the blueprint (max 250 characters)',
			},
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				options: [
					{
						name: 'Procedure',
						value: 'procedure',
					},
					{
						name: 'Form',
						value: 'form',
					},
					{
						name: 'Document',
						value: 'document',
					},
				],
				default: 'procedure',
				required: true,
				displayOptions: {
					show: {
						resource: ['blueprint'],
						operation: ['create'],
					},
				},
				description: 'The type of blueprint',
			},

			// ===== PROCESS FIELDS =====
			{
				displayName: 'Process ID',
				name: 'processId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['process'],
						operation: ['get', 'update', 'archive', 'getTasks', 'reactivate', 'completeKickoffForm', 'reopenKickoffForm'],
					},
				},
				description: 'The ID of the process',
			},
			{
				displayName: 'Blueprint ID',
				name: 'blueprintId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['process'],
						operation: ['launch'],
					},
				},
				description: 'The ID of the blueprint to launch',
			},
			{
				displayName: 'Process Name',
				name: 'processName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['process'],
						operation: ['launch'],
					},
				},
				description: 'Name for the new process instance',
			},
			{
				displayName: 'Kickoff Field Values',
				name: 'kickoffValues',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				placeholder: 'Add Kickoff Value',
				displayOptions: {
					show: {
						resource: ['process'],
						operation: ['launch'],
					},
				},
				description:
					'Values for the blueprint kickoff (prerun) form fields, sent when launching. Each entry is resolved against the template kickoff fields and encoded by field type; an entry matching no field fails the execution instead of being silently dropped. Use the "Get kickoff fields" operation to list a template fields.',
				options: [
					{
						displayName: 'Value',
						name: 'values',
						values: [
							{
								displayName: 'Field',
								name: 'field',
								type: 'string',
								default: '',
								description:
									'The kickoff field to set, by its ID, alias or exact label',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description:
									'For dropdown or radio, the option text (exact match). For multiselect, comma-separated option texts. For text, date or number, the value as-is.',
							},
						],
					},
				],
			},

			// ===== TASK FIELDS =====
			{
				displayName: 'Task ID',
				name: 'taskId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['complete', 'get', 'updateProperties', 'delete', 'clone', 'reopen', 'getProcessTask', 'updateProcessTask'],
					},
				},
				description: 'The ID of the task',
			},

			// One-off task creation fields
			{
				displayName: 'Task Title',
				name: 'title',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createOneOff'],
					},
				},
				description: 'Title of the task (max 600 characters)',
			},
			{
				displayName: 'Task Type',
				name: 'task_type',
				type: 'options',
				options: [
					{
						name: 'Task',
						value: 'task',
					},
					{
						name: 'Approval',
						value: 'approval',
					},
					{
						name: 'Expiring',
						value: 'expiring',
					},
					{
						name: 'Email',
						value: 'email',
					},
				],
				default: 'task',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createOneOff'],
					},
				},
				description: 'The type of task',
			},
			{
				displayName: 'Deadline',
				name: 'deadline',
				type: 'dateTime',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createOneOff'],
					},
				},
				description: 'The deadline for the task',
			},

			// Required fields for task update
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['updateProperties'],
					},
				},
				description: 'Title of the task (required for update)',
			},
			{
				displayName: 'Deadline',
				name: 'deadline',
				type: 'dateTime',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['updateProperties'],
					},
				},
				description: 'Deadline for the task (required for update)',
			},
			// Task property update fields
			{
				displayName: 'Update Fields',
				name: 'updateFields',
				type: 'collection',
				placeholder: 'Add Property',
				default: {},
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['updateProperties'],
					},
				},
				options: [
					{
						displayName: 'Assign Groups',
						name: 'assignGroups',
						type: 'string',
						default: '',
						description: 'Comma-separated list of group IDs to assign',
					},
					{
						displayName: 'Assign Guests',
						name: 'assignGuests',
						type: 'string',
						default: '',
						description: 'Comma-separated list of guest emails to assign',
					},
					{
						displayName: 'Assign Users',
						name: 'assignUsers',
						type: 'string',
						default: '',
						description: 'Comma-separated list of user IDs to assign',
					},
					{
						displayName: 'Max Assignable',
						name: 'max_assignable',
						type: 'number',
						default: 0,
						description: 'Maximum number of assignees allowed',
					},
					{
						displayName: 'Prevent Guest Comment',
						name: 'prevent_guest_comment',
						type: 'boolean',
						default: false,
						description: 'Whether to prevent guests from commenting',
					},
					{
						displayName: 'Task Type',
						name: 'task_type',
						type: 'options',
						options: [
							{
								name: 'Task',
								value: 'task',
							},
							{
								name: 'Approval',
								value: 'approval',
							},
							{
								name: 'Expiring',
								value: 'expiring',
							},
							{
								name: 'Email',
								value: 'email',
							},
						],
						default: 'task',
						description: 'Change the task type',
					},
					{
						displayName: 'Top Secret',
						name: 'top_secret',
						type: 'boolean',
						default: false,
						description: 'Whether to mark the task as top secret',
					},
				],
			},

			// Task one-off additional fields
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createOneOff', 'complete'],
					},
				},
				options: [
					{
						displayName: 'Assign Groups',
						name: 'assignGroups',
						type: 'string',
						default: '',
						description: 'Comma-separated list of group IDs to assign',
					},
					{
						displayName: 'Assign Guests',
						name: 'assignGuests',
						type: 'string',
						default: '',
						description: 'Comma-separated list of guest emails to assign',
					},
					{
						displayName: 'Assign Users',
						name: 'assignUsers',
						type: 'string',
						default: '',
						description: 'Comma-separated list of user IDs to assign',
					},
					{
						displayName: 'Comment',
						name: 'comment',
						type: 'string',
						typeOptions: {
							rows: 4,
						},
						default: '',
						description: 'Comment to add when completing the task',
					},
					{
						displayName: 'Everyone Must Complete',
						name: 'everyone_must_complete',
						type: 'boolean',
						default: false,
						description: 'Whether all assignees must complete the task',
					},
					{
						displayName: 'Start Date',
						name: 'started_at',
						type: 'dateTime',
						default: '',
						description: 'When the task should start',
					},
					{
						displayName: 'Summary',
						name: 'summary',
						type: 'string',
						default: '',
						description: 'Task summary',
					},
					{
						displayName: 'Tags',
						name: 'tags',
						type: 'string',
						default: '',
						description: 'Comma-separated list of tag IDs',
					},
					{
						displayName: 'Webhook URL',
						name: 'webhook',
						type: 'string',
						default: '',
						description: 'Webhook to call on task events',
					},
				],
			},

			// ===== FORM FIELD FIELDS =====
			{
				displayName: 'Context Type',
				name: 'contextType',
				type: 'options',
				options: [
					{
						name: 'Process',
						value: 'process',
					},
					{
						name: 'Blueprint',
						value: 'blueprint',
					},
				],
				default: 'process',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['getFields'],
					},
				},
				description: 'Whether to get fields from a process or blueprint',
			},
			{
				displayName: 'Process ID',
				name: 'processId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['getFields'],
						contextType: ['process'],
					},
				},
				description: 'The ID of the process',
			},
			{
				displayName: 'Blueprint ID',
				name: 'blueprintId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['getFields'],
						contextType: ['blueprint'],
					},
				},
				description: 'The ID of the blueprint',
			},
			{
				displayName: 'Form Field ID',
				name: 'formFieldId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
					},
				},
				description: 'The ID of the STORED form-field value (CaptureValue ID) to update, NOT the field-definition ID. A run-level field only gains a CaptureValue once a value has been stored on it, so updating a never-filled run-level field currently fails server-side (api-v2 #9: PUT /form-field/value resolves the value by CaptureValue ID with no null-guard and no create-if-missing). For launch-time Kick-off values use the process:launch Kick-off Values collection instead.',
			},
			{
				displayName: 'Field Type',
				name: 'fieldType',
				type: 'options',
				options: [
					{ name: 'Assignees', value: 'assignees_form' },
					{ name: 'Date', value: 'date' },
					{ name: 'Dropdown', value: 'dropdown' },
					{ name: 'Email', value: 'email' },
					{ name: 'File', value: 'file' },
					{ name: 'Long Text', value: 'textarea' },
					{ name: 'Multi-Select', value: 'multiselect' },
					{ name: 'Radio Buttons', value: 'radio' },
					{ name: 'Short Text', value: 'text' },
					{ name: 'Table', value: 'table' },
				],
				default: 'text',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
					},
				},
				description: 'The field_type of the field being set. The API validates form_value against it and rejects the wrong shape, so it must match the field as defined on the step or kickoff form. Get Fields reports each field\'s field_type and options.',
			},
			{
				displayName: 'Field Value',
				name: 'fieldValue',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
						fieldType: ['text', 'textarea', 'email', 'date', 'radio'],
					},
				},
				description: 'The value to set. For Radio Buttons this is the chosen option\'s text exactly as defined on the field: radio takes bare text, unlike Dropdown which takes an ID and text pair.',
			},
			{
				displayName: 'Option ID',
				name: 'dropdownOptionId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
						fieldType: ['dropdown'],
					},
				},
				description: 'The ID of the chosen option, taken from the field\'s options list. A whole-number ID is sent as a number so the stored value keeps the option\'s own type.',
			},
			{
				displayName: 'Option Text',
				name: 'dropdownOptionText',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
						fieldType: ['dropdown'],
					},
				},
				description: 'The text of the chosen option. It must match the option definition exactly, or the API rejects the call with "Invalid dropdown choice selected".',
			},
			{
				displayName: 'Value (JSON)',
				name: 'fieldValueJson',
				type: 'json',
				default: '[]',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
						fieldType: ['multiselect', 'table', 'file'],
					},
				},
				description: 'Multi-Select: an array of chosen options, each carrying the option ID and the option text exactly as defined on the field, plus a selected flag set true per item when the field requires every choice to be checked. Table: an array of rows whose length equals the field\'s column count. File: the file payload object.',
			},
			{
				displayName: 'Assignee Users',
				name: 'assigneesUsers',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
						fieldType: ['assignees_form'],
					},
				},
				description: 'Comma-separated member IDs',
			},
			{
				displayName: 'Assignee Guests',
				name: 'assigneesGuests',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
						fieldType: ['assignees_form'],
					},
				},
				description: 'Comma-separated guest emails',
			},
			{
				displayName: 'Assignee Groups',
				name: 'assigneesGroups',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
						fieldType: ['assignees_form'],
					},
				},
				description: 'Comma-separated group IDs',
			},
			{
				displayName: 'As Guest',
				name: 'asGuest',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
					},
				},
				description: 'Whether to update as a guest (requires the guest code). For a task field the task must be active and the guest assigned to it, unless the process is public. For a kick-off field the process must not be complete and the guest must be assigned to one of its live tasks. Otherwise the API answers 403.',
			},
			{
				// Was 'guestEmail' until tallyfy/n8n#47. api-v2 resolves the {guest} slot of
				// POST guests/{guest}/form-field/value by the guest's code, never by email, so an
				// email never matched. A workflow saved with the old parameter now stops with a
				// clear error instead of a 404.
				displayName: 'Guest Code',
				name: 'guestCode',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
						asGuest: [true],
					},
				},
				description: 'The guest\'s access code, not their email. It is the segment between /guest/ and /tasks in the guest\'s link, which the Tallyfy API returns as "link" when you get the guest (GET guests/{email}).',
			},

			// ===== COMMENT FIELDS =====
			{
				displayName: 'Task ID',
				name: 'taskId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['create', 'createBot', 'reportProblem', 'resolveIssue', 'update', 'delete', 'list'],
					},
				},
				description: 'The ID of the task to comment on',
			},
			{
				displayName: 'Comment ID',
				name: 'commentId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['update', 'delete'],
					},
				},
				description: 'The ID of the comment',
			},
			{
				displayName: 'Comment Content',
				name: 'content',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['create', 'createBot', 'reportProblem', 'resolveIssue', 'update'],
					},
				},
				description: 'The comment content (supports HTML)',
			},
			{
				displayName: 'Thread ID',
				name: 'threadId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['resolveIssue'],
					},
				},
				description: 'The ID of the issue thread to resolve',
			},

			// ===== USER FIELDS =====
			{
				displayName: 'User ID',
				name: 'userId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['get', 'updateRole', 'disable', 'enable', 'convertToGuest'],
					},
				},
				description: 'The ID of the user',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'user@example.com',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['invite'],
					},
				},
				description: 'Email address of the user to invite',
			},
			{
				displayName: 'First Name',
				name: 'firstName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['invite'],
					},
				},
				description: 'First name of the user (max 32 characters)',
			},
			{
				displayName: 'Last Name',
				name: 'lastName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['invite'],
					},
				},
				description: 'Last name of the user (max 32 characters)',
			},
			{
				displayName: 'Role',
				name: 'role',
				type: 'options',
				options: [
					{
						name: 'Admin',
						value: 'admin',
					},
					{
						name: 'Standard',
						value: 'standard',
					},
					{
						name: 'Light',
						value: 'light',
					},
				],
				default: 'standard',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['invite', 'updateRole'],
					},
				},
				description: 'Role for the user',
			},
			{
				displayName: 'Invitation Message',
				name: 'message',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: 'You have been invited to join our Tallyfy organization.',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['invite'],
					},
				},
				description: 'Message to include in the invitation (max 5000 characters)',
			},

			// ===== GUEST FIELDS =====
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'guest@example.com',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['guest'],
						operation: ['create', 'get', 'update', 'delete', 'convertToMember', 'enable', 'disable'],
					},
				},
				description: 'Email address of the guest',
			},
			{
				displayName: 'First Name',
				name: 'firstName',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['guest'],
						operation: ['create', 'update'],
					},
				},
				description: 'First name of the guest',
			},
			{
				displayName: 'Last Name',
				name: 'lastName',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['guest'],
						operation: ['create', 'update'],
					},
				},
				description: 'Last name of the guest',
			},

			// ===== GROUP FIELDS =====
			{
				displayName: 'Group Name',
				name: 'name',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['group'],
						operation: ['create'],
					},
				},
				description: 'Name of the group (must be unique)',
			},
			{
				displayName: 'Group ID',
				name: 'groupId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['group'],
						operation: ['get', 'update', 'delete'],
					},
				},
				description: 'The ID of the group',
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['group'],
						operation: ['create', 'update'],
					},
				},
				description: 'Description of the group',
			},
			{
				displayName: 'Members',
				name: 'members',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['group'],
						operation: ['create', 'update'],
					},
				},
				description: 'Comma-separated list of user IDs to add to the group',
			},
			{
				displayName: 'Guests',
				name: 'guests',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['group'],
						operation: ['create', 'update'],
					},
				},
				description: 'Comma-separated list of guest emails to add to the group',
			},

			// ===== SEARCH FIELDS =====
			{
				displayName: 'Search Query',
				name: 'searchQuery',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['search'],
					},
				},
			},
			{
				displayName: 'Search In',
				name: 'searchIn',
				type: 'multiOptions',
				options: [
					{
						name: 'Blueprints',
						value: 'blueprint',
					},
					{
						name: 'Form Fields',
						value: 'capture',
					},
					{
						name: 'Processes',
						value: 'process',
					},
					{
						name: 'Snippets',
						value: 'snippet',
					},
					{
						name: 'Steps',
						value: 'step',
					},
					{
						name: 'Tasks',
						value: 'task',
					},
				],
				default: ['blueprint', 'process', 'task'],
				displayOptions: {
					show: {
						resource: ['search'],
						operation: ['global'],
					},
				},
				description: 'What types of resources to search',
			},

			// ===== ID FINDER FIELDS =====
			{
				displayName: 'Search Term',
				name: 'searchTerm',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['idFinder'],
					},
				},
				description: 'Name or search term to find the resource',
			},
			{
				displayName: 'Context',
				name: 'context',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['idFinder'],
						operation: ['findFormFieldId'],
					},
				},
				description: 'Process or Blueprint ID containing the form field',
			},
			{
				displayName: 'Context Type',
				name: 'contextType',
				type: 'options',
				options: [
					{
						name: 'Process',
						value: 'process',
					},
					{
						name: 'Blueprint',
						value: 'blueprint',
					},
				],
				default: 'process',
				displayOptions: {
					show: {
						resource: ['idFinder'],
						operation: ['findFormFieldId'],
					},
				},
				description: 'Type of context for form field search',
			},

			{
				displayName: 'New Title',
				name: 'cloneTitle',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['blueprint'],
						operation: ['clone'],
					},
				},
				description: 'Optional new name for the cloned template',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['blueprint'],
						operation: ['create', 'update'],
					},
				},
				options: [
					{
						displayName: 'Summary',
						name: 'summary',
						type: 'string',
						default: '',
						description: 'Short description of the template',
					},
					{
						displayName: 'Guidance',
						name: 'guidance',
						type: 'string',
						default: '',
						description: 'Guidance shown to the launcher',
					},
					{
						displayName: 'Is Public',
						name: 'is_public',
						type: 'boolean',
						default: false,
						description: 'Whether the template is public',
					},
				],
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['process'],
						operation: ['launch', 'update'],
					},
				},
				options: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						description: 'Process name (use to rename on update)',
					},
					{
						displayName: 'Summary',
						name: 'summary',
						type: 'string',
						default: '',
						description: 'Process summary',
					},
					{
						displayName: 'Starred',
						name: 'starred',
						type: 'boolean',
						default: false,
						description: 'Whether the process is starred',
					},
				],
			},
			{
				displayName: 'Process ID',
				name: 'processId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['getProcessTask', 'updateProcessTask'],
					},
				},
				description: 'The ID of the process (run) that contains the task',
			},
			{
				displayName: 'Process ID (Optional)',
				name: 'processId',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['complete', 'reopen'],
					},
				},
				description: 'Set for a process task to use the run-scoped path. Leave empty for a one-off task.',
			},
			{
				displayName: 'Approval Decision',
				name: 'approvalDecision',
				type: 'options',
				options: [
					{
						name: 'Not an Approval',
						value: 'none',
					},
					{
						name: 'Approve',
						value: 'approve',
					},
					{
						name: 'Reject',
						value: 'reject',
					},
				],
				default: 'none',
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['complete'],
					},
				},
				description: 'For approval steps only: whether to approve or reject',
			},
			{
				displayName: 'User ID',
				name: 'userId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['getUserTasks'],
					},
				},
				description: 'The ID of the member whose tasks to list',
			},
			{
				displayName: 'Guest ID',
				name: 'guestId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['getGuestTasks'],
					},
				},
				description: 'The guest ID (from the guest link) whose tasks to list',
			},
			{
				displayName: 'Update Fields',
				name: 'updateProcessTaskFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['updateProcessTask'],
					},
				},
				options: [
					{
						displayName: 'Assign Groups',
						name: 'assignGroups',
						type: 'string',
						default: '',
						description: 'Comma-separated group IDs',
					},
					{
						displayName: 'Assign Guests',
						name: 'assignGuests',
						type: 'string',
						default: '',
						description: 'Comma-separated guest emails',
					},
					{
						displayName: 'Assign Users',
						name: 'assignUsers',
						type: 'string',
						default: '',
						description: 'Comma-separated member IDs',
					},
					{
						displayName: 'Deadline',
						name: 'deadline',
						type: 'dateTime',
						default: '',
					},
					{
						displayName: 'Max Assignable',
						name: 'max_assignable',
						type: 'number',
						default: 0,
					},
					{
						displayName: 'Position',
						name: 'position',
						type: 'number',
						default: 0,
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'string',
						default: '',
						description: 'Task status',
					},
					{
						displayName: 'Summary',
						name: 'summary',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Task Data (JSON)',
						name: 'taskdata',
						type: 'json',
						default: '{}',
						description: 'Form field values keyed by capture ID',
					},
					{
						displayName: 'Title',
						name: 'title',
						type: 'string',
						default: '',
					},
				],
			},
			{
				displayName: 'Process ID',
				name: 'processId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['list'],
					},
				},
				description: 'The ID of the process (run) that contains the task',
			},
			{
				displayName: 'Blueprint ID',
				name: 'blueprintId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['addField', 'updateField', 'moveField', 'deleteField', 'getDropdownOptions', 'updateDropdownOptions', 'addKickoffField', 'updateKickoffField', 'deleteKickoffField', 'reorderKickoffField'],
					},
				},
				description: 'The ID of the template (blueprint)',
			},
			{
				displayName: 'Step ID',
				name: 'stepId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['addField', 'updateField', 'moveField', 'deleteField', 'getDropdownOptions', 'updateDropdownOptions'],
					},
				},
				description: 'The ID of the step',
			},
			{
				displayName: 'Field ID',
				name: 'captureFieldId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateField', 'moveField', 'deleteField', 'getDropdownOptions', 'updateDropdownOptions'],
					},
				},
				description: 'The ID of the form field (capture)',
			},
			{
				displayName: 'Target Step ID',
				name: 'targetStepId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['moveField'],
					},
				},
				description: 'The step to move the field to',
			},
			{
				displayName: 'Position',
				name: 'fieldPosition',
				type: 'number',
				default: 1,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['moveField'],
					},
				},
				description: 'Position in the target step',
			},
			{
				displayName: 'Field Definition (JSON)',
				name: 'fieldData',
				type: 'json',
				default: '{}',
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['addField', 'updateField', 'addKickoffField', 'updateKickoffField'],
					},
				},
				description: 'Field definition. For add, include field_type and label. For update, only the properties to change (field_type is immutable).',
			},
			{
				displayName: 'Options',
				name: 'dropdownOptions',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateDropdownOptions'],
					},
				},
				description: 'One option per line (or comma-separated); replaces the full options list',
			},
			{
				displayName: 'Kickoff Field ID',
				name: 'kickoffFieldId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateKickoffField', 'deleteKickoffField'],
					},
				},
				description: 'The ID of the kickoff (prerun) field',
			},
			{
				displayName: 'Field Order',
				name: 'fieldOrder',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['reorderKickoffField'],
					},
				},
				description: 'Comma-separated kickoff field IDs in the desired order',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['tag'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create a tag',
						action: 'Create a tag',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a tag',
						action: 'Delete a tag',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'List org tags',
						action: 'Get many tags',
					},
					{
						name: 'Tag Process',
						value: 'tagProcess',
						description: 'Attach a tag to a process',
						action: 'Tag a process',
					},
					{
						name: 'Tag Template',
						value: 'tagTemplate',
						description: 'Attach a tag to a template',
						action: 'Tag a template',
					},
					{
						name: 'Untag Process',
						value: 'untagProcess',
						description: 'Remove a tag from a process',
						action: 'Untag a process',
					},
					{
						name: 'Untag Template',
						value: 'untagTemplate',
						description: 'Remove a tag from a template',
						action: 'Untag a template',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a tag',
						action: 'Update a tag',
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Tag ID',
				name: 'tagId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['tag'],
						operation: ['update', 'delete', 'tagTemplate', 'tagProcess'],
					},
				},
				description: 'The ID of the tag',
			},
			{
				displayName: 'Title',
				name: 'tagTitle',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['tag'],
						operation: ['create'],
					},
				},
				description: 'The tag title',
			},
			{
				displayName: 'Title',
				name: 'tagTitle',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['tag'],
						operation: ['update'],
					},
				},
				description: 'New tag title',
			},
			{
				displayName: 'Color',
				name: 'tagColor',
				type: 'color',
				placeholder: '#FF5733',
				default: '',
				displayOptions: {
					show: {
						resource: ['tag'],
						operation: ['create', 'update'],
					},
				},
				description: 'Optional hex color',
			},
			{
				displayName: 'Subject ID',
				name: 'subjectId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['tag'],
						operation: ['tagTemplate', 'tagProcess'],
					},
				},
				description: 'The template or process ID to tag',
			},
			{
				displayName: 'Association ID',
				name: 'associationId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['tag'],
						operation: ['untagTemplate', 'untagProcess'],
					},
				},
				description: 'The tag-association ID (fetch the object with=tags to find it)',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['folder'],
					},
				},
				options: [
					{
						name: 'Add To Folder',
						value: 'addToFolder',
						description: 'Add a template or process to a folder',
						action: 'Add to folder',
					},
					{
						name: 'Create',
						value: 'create',
						description: 'Create a folder',
						action: 'Create a folder',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a folder',
						action: 'Delete a folder',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'List folders',
						action: 'Get many folders',
					},
					{
						name: 'Remove From Folder',
						value: 'removeFromFolder',
						description: 'Remove an object from a folder',
						action: 'Remove from folder',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a folder',
						action: 'Update a folder',
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Folder Type',
				name: 'folderType',
				type: 'options',
				options: [
					{
						name: 'Template Folders',
						value: 'checklist',
					},
					{
						name: 'Process Folders',
						value: 'run',
					},
				],
				default: 'checklist',
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['getAll'],
					},
				},
				description: 'Which folder tree to list',
			},
			{
				displayName: 'Name',
				name: 'folderName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['create'],
					},
				},
				description: 'The folder name',
			},
			{
				displayName: 'Name',
				name: 'folderName',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['update'],
					},
				},
				description: 'New folder name',
			},
			{
				displayName: 'Folder ID',
				name: 'folderId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['update', 'delete', 'addToFolder'],
					},
				},
				description: 'The ID of the folder',
			},
			{
				displayName: 'Parent Folder ID',
				name: 'folderParentId',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['create', 'update'],
					},
				},
				description: 'Optional parent folder ID for nesting',
			},
			{
				displayName: 'Object Type',
				name: 'folderObjectType',
				type: 'options',
				options: [
					{
						name: 'Template',
						value: 'checklist',
					},
					{
						name: 'Process',
						value: 'run',
					},
				],
				default: 'checklist',
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['addToFolder'],
					},
				},
				description: 'Whether you are foldering a template or a process',
			},
			{
				displayName: 'Object ID',
				name: 'folderObjectId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['addToFolder'],
					},
				},
				description: 'The template or process ID to put in the folder',
			},
			{
				displayName: 'Folder Object ID',
				name: 'folderRelationId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['removeFromFolder'],
					},
				},
				description: 'The folder-object relation ID to remove',
			},

			// ===== SCHEDULED JOB FIELDS =====
			{
				displayName: 'Scheduled Job ID',
				name: 'scheduledJobId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['get', 'getHistory', 'update', 'pause', 'resume', 'delete'],
					},
				},
				description: 'The ID of the scheduled job, a whole number such as 42',
			},
			{
				displayName: 'Only Jobs I Created',
				name: 'createdByMe',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['getAll'],
					},
				},
				description: 'Whether to list only the jobs the connected user created. A job saved before Tallyfy recorded who created it is never listed this way.',
			},
			{
				displayName: 'Name',
				name: 'jobName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
					},
				},
				description: 'A name for the job, up to 50 characters',
			},
			{
				displayName: 'Job Type',
				name: 'jobType',
				type: 'options',
				options: [
					{
						name: 'Create Task',
						value: 'createTask',
						description: 'Create a standalone task each time the job runs',
					},
					{
						name: 'Launch Process',
						value: 'launchProcess',
						description: 'Launch a process from a blueprint each time the job runs',
					},
				],
				default: 'createTask',
				required: true,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
					},
				},
				description: 'What the job does when it runs',
			},
			{
				displayName: 'Frequency',
				name: 'frequency',
				type: 'options',
				options: [
					{
						name: 'Once',
						value: 'once',
						description: 'Run one time, on the start date at the start time',
					},
					{
						name: 'Recurring',
						value: 'recurring',
						description: 'Run on a repeating schedule',
					},
				],
				default: 'once',
				required: true,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
					},
				},
				description: 'Whether the job runs once or repeats',
			},
			{
				displayName: 'Start Date',
				name: 'startDate',
				type: 'dateTime',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
					},
				},
				description: 'The day a Once job runs, or the first day a Recurring job may run. Only the day is used. Set the time of day in Start Time.',
			},
			{
				displayName: 'Start Time',
				name: 'startTime',
				type: 'string',
				default: '09:00',
				required: true,
				placeholder: '09:00',
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
					},
				},
				description: 'The time of day the job runs, as 24 hour HH:mm, such as 09:00 or 17:30. Tallyfy reads the start date and time in UTC, or in the organization time zone where your Tallyfy version supports one.',
			},
			{
				displayName: 'Repeat',
				name: 'recurringType',
				type: 'options',
				options: [
					{ name: 'Daily', value: 'daily' },
					{ name: 'Hourly', value: 'hourly' },
					{ name: 'Monthly', value: 'monthly' },
					{ name: 'Weekly', value: 'weekly' },
					{ name: 'Yearly', value: 'yearly' },
				],
				default: 'daily',
				required: true,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						frequency: ['recurring'],
					},
				},
				description: 'How often the job repeats. A Yearly job runs on the month and day of the start date.',
			},
			{
				displayName: 'Every',
				name: 'interval',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 1,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						frequency: ['recurring'],
					},
				},
				description: 'The gap between runs, counted in the unit chosen in Repeat. 2 with Weekly runs every other week.',
			},
			{
				displayName: 'Days of Week',
				name: 'daysOfWeek',
				type: 'multiOptions',
				options: WEEKDAY_OPTIONS,
				default: [],
				required: true,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						frequency: ['recurring'],
						recurringType: ['weekly'],
					},
				},
				description: 'The days a Weekly job runs on. A Tallyfy version that stores one weekday keeps the earliest of them, counting from Monday.',
			},
			{
				displayName: 'Monthly Schedule',
				name: 'monthlyOn',
				type: 'options',
				options: [
					{
						name: 'Day of Month',
						value: 'dayOfMonth',
						description: 'A numbered day, such as the 15th',
					},
					{
						name: 'Weekday of Month',
						value: 'weekdayOfMonth',
						description: 'A weekday in a numbered week, such as the second Tuesday',
					},
				],
				default: 'dayOfMonth',
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						frequency: ['recurring'],
						recurringType: ['monthly'],
					},
				},
				description: 'Which day of the month a Monthly job runs on',
			},
			{
				displayName: 'Day of Month',
				name: 'dayOfMonth',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 31,
				},
				default: 1,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						frequency: ['recurring'],
						recurringType: ['monthly'],
						monthlyOn: ['dayOfMonth'],
					},
				},
				description: 'The day of the month the job runs on, from 1 to 31',
			},
			{
				displayName: 'Week of Month',
				name: 'weekOfMonth',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 5,
				},
				default: 1,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						frequency: ['recurring'],
						recurringType: ['monthly'],
						monthlyOn: ['weekdayOfMonth'],
					},
				},
				description: 'Which week of the month, from 1 to 5. Some months have no fifth week.',
			},
			{
				displayName: 'Weekday',
				name: 'weekday',
				type: 'options',
				options: WEEKDAY_OPTIONS,
				default: 1,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						frequency: ['recurring'],
						recurringType: ['monthly'],
						monthlyOn: ['weekdayOfMonth'],
					},
				},
				description: 'The weekday in that week',
			},
			{
				displayName: 'Adjust to Nearest Date',
				name: 'adjustToNearestDate',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						frequency: ['recurring'],
						recurringType: ['monthly'],
					},
				},
				description: 'Whether a month that lacks the chosen day still gets a run: on its last day for a day such as the 31st, or in its fourth week when it has no fifth. Off skips that month.',
			},

			// Create Task job: what each run creates. The API checks this `data` with the same rules as
			// POST /tasks, plus the deadline rule for how often the job runs (api-v2 ScheduledTaskData).
			{
				displayName: 'Task Title',
				name: 'taskTitle',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						jobType: ['createTask'],
					},
				},
				description: 'The title of each task the job creates, up to 600 characters',
			},
			{
				displayName: 'Task Type',
				name: 'taskType',
				type: 'options',
				options: [
					{ name: 'Approval', value: 'approval' },
					{ name: 'Email', value: 'email' },
					{ name: 'Expiring', value: 'expiring' },
					{ name: 'Expiring Email', value: 'expiring_email' },
					{ name: 'Task', value: 'task' },
				],
				default: 'task',
				required: true,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						jobType: ['createTask'],
					},
				},
				description: 'The type of each task the job creates',
			},
			{
				displayName: 'Deadline',
				name: 'taskDeadline',
				type: 'dateTime',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						jobType: ['createTask'],
						frequency: ['once'],
					},
				},
				description: 'When the task is due. It must be after the moment the job runs. A relative value such as +2 days, set with an expression, is counted from that moment.',
			},
			{
				displayName: 'Due After',
				name: 'deadlineOffsetValue',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 1,
				required: true,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						jobType: ['createTask'],
						frequency: ['recurring'],
					},
				},
				description: 'How long after each task is created it is due, counted in Due After Unit. A recurring task job takes this in place of a fixed deadline.',
			},
			{
				displayName: 'Due After Unit',
				name: 'deadlineOffsetUnit',
				type: 'options',
				options: [
					{ name: 'Days', value: 'days' },
					{ name: 'Hours', value: 'hours' },
					{ name: 'Minutes', value: 'minutes' },
					{ name: 'Months', value: 'months' },
					{ name: 'Weeks', value: 'weeks' },
				],
				default: 'days',
				required: true,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						jobType: ['createTask'],
						frequency: ['recurring'],
					},
				},
				description: 'The unit Due After counts in',
			},
			{
				displayName: 'Task Options',
				name: 'taskOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						jobType: ['createTask'],
					},
				},
				options: [
					{
						displayName: 'Assign Groups',
						name: 'assignGroups',
						type: 'string',
						default: '',
						description: 'Comma-separated list of group IDs to assign',
					},
					{
						displayName: 'Assign Guests',
						name: 'assignGuests',
						type: 'string',
						default: '',
						description: 'Comma-separated list of guest emails to assign',
					},
					{
						displayName: 'Assign Users',
						name: 'assignUsers',
						type: 'string',
						default: '',
						description: 'Comma-separated list of member IDs to assign',
					},
					{
						displayName: 'Can Complete Only Assignees',
						name: 'can_complete_only_assignees',
						type: 'boolean',
						default: false,
						description: 'Whether only the assignees may complete the task',
					},
					{
						displayName: 'Everyone Must Complete',
						name: 'everyone_must_complete',
						type: 'boolean',
						default: false,
						description: 'Whether all assignees must complete the task',
					},
					{
						displayName: 'Extra Task Data (JSON)',
						name: 'extraTaskData',
						type: 'json',
						default: '{}',
						description: 'Any other keys POST /tasks takes, such as form_fields, added to the task data. The options above win where both name a key.',
					},
					{
						displayName: 'Max Assignable',
						name: 'max_assignable',
						type: 'number',
						default: 0,
						description: 'Maximum number of assignees allowed',
					},
					{
						displayName: 'Prevent Guest Comment',
						name: 'prevent_guest_comment',
						type: 'boolean',
						default: false,
						description: 'Whether to prevent guests from commenting',
					},
					{
						displayName: 'Process ID',
						name: 'run_id',
						type: 'string',
						default: '',
						description: 'Add each task to this process (run). Leave empty for a standalone task.',
					},
					{
						displayName: 'Separate Task for Each Assignee',
						name: 'separate_task_for_each_assignee',
						type: 'boolean',
						default: false,
						description: 'Whether to create one task per assignee',
					},
					{
						displayName: 'Start Date',
						name: 'started_at',
						type: 'dateTime',
						default: '',
						description: 'When the task starts. Once jobs only: each task a Recurring job creates starts when it is created.',
					},
					{
						displayName: 'Tags',
						name: 'tags',
						type: 'string',
						default: '',
						description: 'Comma-separated list of tag IDs',
					},
					{
						displayName: 'Top Secret',
						name: 'top_secret',
						type: 'boolean',
						default: false,
						description: 'Whether to mark the task as top secret',
					},
					{
						displayName: 'Webhook URL',
						name: 'webhook',
						type: 'string',
						default: '',
						description: 'Webhook to call on task events',
					},
				],
			},

			// Launch Process job: what each run launches. The API hands this `data` to the same
			// RunService::startRun that POST /runs uses, so `prerun` is keyed by kickoff field ID.
			{
				displayName: 'Blueprint ID',
				name: 'blueprintId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						jobType: ['launchProcess'],
					},
				},
				description: 'The ID of the blueprint (template) each run launches',
			},
			{
				displayName: 'Process Name',
				name: 'processName',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						jobType: ['launchProcess'],
					},
				},
				description: 'Name for each process the job launches, up to 300 characters',
			},
			{
				displayName: 'Kickoff Field Values',
				name: 'kickoffValues',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				placeholder: 'Add Kickoff Value',
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						jobType: ['launchProcess'],
					},
				},
				description:
					'Values for the blueprint kickoff (prerun) form fields, resolved and encoded when the job is created, exactly as Process: Launch does. An entry matching no field fails the execution.',
				options: [
					{
						displayName: 'Value',
						name: 'values',
						values: [
							{
								displayName: 'Field',
								name: 'field',
								type: 'string',
								default: '',
								description: 'The kickoff field to set, by its ID, alias or exact label',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description:
									'For dropdown or radio, the option text (exact match). For multiselect, comma-separated option texts. For text, date or number, the value as-is.',
							},
						],
					},
				],
			},
			{
				displayName: 'Process Options',
				name: 'processOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
						jobType: ['launchProcess'],
					},
				},
				options: [
					{
						displayName: 'Extra Process Data (JSON)',
						name: 'extraProcessData',
						type: 'json',
						default: '{}',
						description: 'Any other keys a launch takes, such as tasks or users, added to the job data. Blueprint ID, Process Name and Kickoff Field Values win where both name a key.',
					},
				],
			},
			{
				displayName: 'Additional Fields',
				name: 'scheduledJobFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['create'],
					},
				},
				options: [
					{
						displayName: 'Description',
						name: 'description',
						type: 'string',
						default: '',
						description: 'A description of the job, up to 500 characters',
					},
					{
						displayName: 'End Date',
						name: 'endDate',
						type: 'dateTime',
						default: '',
						description: 'Recurring jobs only: the last day the job may run',
					},
					{
						displayName: 'Max Runs',
						name: 'maxRuns',
						type: 'number',
						typeOptions: {
							minValue: 2,
						},
						default: 2,
						description: 'Recurring jobs only: stop after the job has run this many times',
					},
					{
						displayName: 'Start Paused',
						name: 'startPaused',
						type: 'boolean',
						default: false,
						description: 'Whether to save the job paused, so it does not run until it is resumed',
					},
				],
			},
			{
				displayName: 'Update Fields',
				name: 'scheduledJobUpdateFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['scheduledJob'],
						operation: ['update'],
					},
				},
				options: [
					{
						displayName: 'Adjust to Nearest Date',
						name: 'adjustToNearestDate',
						type: 'boolean',
						default: false,
						description: 'Whether a month that lacks the chosen day still gets a run (Monthly jobs)',
					},
					{
						displayName: 'Data (JSON)',
						name: 'jobData',
						type: 'json',
						default: '{}',
						description: 'Keys to change in what the job does, laid over its stored data. A task job takes keys such as title, deadline (Once) or deadline_offset (Recurring). A launch job takes keys such as checklist_id, name or prerun.',
					},
					{
						displayName: 'Day of Month',
						name: 'dayOfMonth',
						type: 'number',
						typeOptions: {
							minValue: 1,
							maxValue: 31,
						},
						default: 1,
						description: 'The day of the month a Monthly job runs on',
					},
					{
						displayName: 'Days of Week',
						name: 'daysOfWeek',
						type: 'multiOptions',
						options: WEEKDAY_OPTIONS,
						default: [],
						description: 'The days a Weekly job runs on, or the one weekday of a Monthly job that runs on a weekday of the month',
					},
					{
						displayName: 'Description',
						name: 'description',
						type: 'string',
						default: '',
						description: 'A description of the job, up to 500 characters',
					},
					{
						displayName: 'End Date',
						name: 'endDate',
						type: 'dateTime',
						default: '',
						description: 'The last day the job may run',
					},
					{
						displayName: 'Every',
						name: 'interval',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: 1,
						description: 'The gap between runs, counted in the unit of Repeat',
					},
					{
						displayName: 'Max Runs',
						name: 'maxRuns',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: 2,
						description: 'How many times the job runs in all. 1 makes it a one-time job.',
					},
					{
						displayName: 'Month of Year',
						name: 'monthOfYear',
						type: 'number',
						typeOptions: {
							minValue: 1,
							maxValue: 12,
						},
						default: 1,
						description: 'The month a Yearly job runs in, from 1 to 12',
					},
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						description: 'A new name for the job, up to 50 characters',
					},
					{
						displayName: 'Repeat',
						name: 'recurringType',
						type: 'options',
						options: [
							{ name: 'Daily', value: 'daily' },
							{ name: 'Hourly', value: 'hourly' },
							{ name: 'Monthly', value: 'monthly' },
							{ name: 'Weekly', value: 'weekly' },
							{ name: 'Yearly', value: 'yearly' },
						],
						default: 'daily',
						description: 'How often the job repeats',
					},
					{
						displayName: 'Start Date',
						name: 'startDate',
						type: 'dateTime',
						default: '',
						description: 'The day a Once job runs, or the first day a Recurring job may run. Only the day is used.',
					},
					{
						displayName: 'Start Time',
						name: 'startTime',
						type: 'string',
						default: '09:00',
						placeholder: '09:00',
						description: 'The time of day the job runs, as 24 hour HH:mm',
					},
					{
						displayName: 'Week of Month',
						name: 'weekOfMonth',
						type: 'number',
						typeOptions: {
							minValue: 1,
							maxValue: 5,
						},
						default: 1,
						description: 'Which week of the month a Monthly job runs in, from 1 to 5',
					},
				],
			},
			// ===== GENERAL LIST OPERATION FIELDS =====
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				displayOptions: {
					show: {
						operation: ['getAll', 'getMyTasks', 'getUserTasks', 'getGuestTasks'],
					},
				},
				default: false,
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				displayOptions: {
					show: {
						operation: ['getAll', 'getMyTasks', 'getUserTasks', 'getGuestTasks'],
						returnAll: [false],
					},
				},
				typeOptions: {
					minValue: 1,
					maxValue: 100,
				},
				default: 50,
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: {
					show: {
						operation: ['getAll', 'getMyTasks', 'getUserTasks', 'getGuestTasks'],
					},
					// GET recurring-jobs reads none of these; its one filter is Only Jobs I Created.
					hide: {
						resource: ['scheduledJob'],
					},
				},
				options: [
					{
						displayName: 'Search',
						name: 'q',
						type: 'string',
						default: '',
						description: 'Search query',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{
								name: 'Active',
								value: 'active',
							},
							{
								name: 'Archived',
								value: 'archived',
							},
							{
								name: 'Completed',
								value: 'completed',
							},
							{
								name: 'Draft',
								value: 'draft',
							},
							{
								// Process (run) status for a process blocked by an open process-level
								// issue (api-v2#5110 / PR #9466). The server folds `issue` runs into the
								// `problem` filter. Accepted (HTTP 200) by the other resource list
								// endpoints too, so it is harmless on this shared filter. See tallyfy/n8n#1.
								name: 'Issue',
								value: 'issue',
							},
						],
						default: 'active',
						description: 'Filter by status. Note: "Issue" applies to processes (runs) blocked by an open process-level issue.',
					},
					{
						displayName: 'Tags',
						name: 'tag',
						type: 'string',
						default: '',
						description: 'Filter by tags (comma-separated)',
					},
					{
						displayName: 'Sort By',
						name: 'sort',
						type: 'options',
						options: [
							{
								name: 'Created Date (Newest)',
								value: '-created_at',
							},
							{
								name: 'Created Date (Oldest)',
								value: 'created_at',
							},
							{
								name: 'Name (A-Z)',
								value: 'name',
							},
							{
								name: 'Name (Z-A)',
								value: '-name',
							},
							{
								name: 'Updated Date (Newest)',
								value: '-updated_at',
							},
							{
								name: 'Updated Date (Oldest)',
								value: 'updated_at',
							},
						],
						default: '-created_at',
						description: 'How to sort results',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0);
		const operation = this.getNodeParameter('operation', 0);
		const credentials = await this.getCredentials('tallyfyApi');
		const baseUrl = (credentials.baseUrl as string) || 'https://go.tallyfy.com/api';
		const organizationId = credentials.organizationId as string;

		// Coerce a JSON-typed node parameter (which may arrive as a string) into an object.
		const asObject = (value: unknown): IDataObject => {
			if (typeof value === 'string') {
				return value.trim() ? (JSON.parse(value) as IDataObject) : {};
			}
			return (value as IDataObject) || {};
		};

		// Same coercion for JSON parameters whose value is a LIST (multiselect options,
		// table rows). asObject() would turn those into an object, so keep arrays as arrays.
		const asJsonValue = (value: unknown): IDataObject | IDataObject[] => {
			if (typeof value === 'string') {
				return value.trim() ? (JSON.parse(value) as IDataObject | IDataObject[]) : [];
			}
			return (value as IDataObject | IDataObject[]) ?? [];
		};

		// Comma-separated node input -> trimmed list, matching the assignee inputs elsewhere.
		const splitList = (value: string): string[] =>
			value.split(',').map(entry => entry.trim()).filter(Boolean);

		// Lenient choice equality (#178): match a template option when the caller's value differs
		// only by letter case or surrounding whitespace. Mirrors middleware lib/tallyfy.js
		// canonicalChoiceEq and the Tallyfy CLI / MCP server; the caller then sends the option's
		// own canonical text, never the raw input.
		const canonicalChoiceEq = (optionText: unknown, rawValue: unknown): boolean =>
			String(optionText ?? '').trim().toLowerCase() === String(rawValue ?? '').trim().toLowerCase();

		// Resolve a caller's choice value to one template option, one PASS AT A TIME, each pass
		// running over the WHOLE option list before the next begins (tallyfy/middleware#240):
		//
		//   1. exact text
		//   2. case-insensitive + trimmed text (canonicalChoiceEq, #178)
		//   3. option id, tolerating surrounding whitespace in the caller's value (#30)
		//
		// The pass separation is the whole point. All three arms used to sit inside ONE
		// Array.prototype.find, which evaluates every arm against option A before it looks at
		// option B, so when one option's id equalled another option's text the winner was decided
		// by OPTION ORDER and nothing said so. Options [{id: 9, text: 'Gold'}, {id: 1, text: '9'}]
		// with the value '9' resolved to Gold purely because Gold is listed first; api-v2 accepts
		// either encoding, so the caller got the wrong option silently.
		//
		// Owner decision on tallyfy/middleware#240 (2026-08-14), taken across all six connectors:
		// prefer text over id, rather than rejecting the ambiguity (a behaviour regression for
		// callers relying on today's silent pick) or keeping first-match-wins.
		//
		// Passes 1 and 2 are UNCHANGED IN CONTENT; only their scope widens from "first match in a
		// mixed scan" to "first match in a text-only scan". So every value that matched exactly one
		// option before still resolves to that same option.
		//
		// textValue and idValue are separate parameters because the three branches below still
		// feed the TEXT arm differently (dropdown trims before calling; radio and multiselect do
		// not need to - see each call site) and that difference is preserved rather than quietly
		// normalised. The ID arm is different: it is trimmed HERE, once, for every caller (#30,
		// owner decision 2026-08-22, recorded on tallyfy/middleware#240). Before #30 the three
		// branches disagreed on whether the id arm was fed trimmed or raw, so one caller passing
		// one padded id to one template got three different answers depending on the field type -
		// see #30's own measurement. Trimming centrally here removes the need for every call site
		// to agree, and matches what the text passes already tolerated via canonicalChoiceEq.
		const resolveChoiceOption = (
			options: IDataObject[],
			textValue: unknown,
			idValue: unknown,
		): IDataObject | undefined => {
			let opt = options.find(o => String(o.text) === String(textValue));
			if (!opt) {
				opt = options.find(o => canonicalChoiceEq(o.text, textValue));
			}
			if (!opt) {
				opt = options.find(o => String(o.id) === String(idValue).trim());
			}
			return opt;
		};

		// Encode a Kick-off (prerun) value for the launch `prerun` object, per the field's type.
		// Mirrors middleware lib/tallyfy.js processFieldValue: choice fields resolve the option by
		// its TEXT and send the structured shape the API stores; scalars pass through. The API
		// stores dropdown as {id,text}, multiselect as [{id,text,selected:true}] and radio/text as
		// a bare scalar - proven by a create -> GET /runs/{id}?with=prerun round-trip on staging.
		const encodeKickoffValue = (field: IDataObject, rawValue: unknown, itemIndex: number): unknown => {
			const fieldType = field.field_type as string;
			const options = (field.options as IDataObject[]) || [];
			const label = (field.label as string) || (field.id as string);
			if (fieldType === 'dropdown') {
				const text = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
				// Text passes first over the whole option list, then the id pass (#240); either way
				// the option's own canonical text is sent, never the raw input.
				//
				// The id arm was added to the `radio` branch below when radio parity landed and NOT
				// here, which left this node internally inconsistent: an option id resolved for
				// radio and THREW for dropdown, so one caller passing one id to one template got
				// two different answers depending on the field type. Celigo's findOption and the
				// MCP server's _match_option have accepted ids on all three types all along.
				// Converging up rather than down was an explicit owner decision on 2026-08-12,
				// applied to Zapier and Workato in tallyfy/middleware in the same breath.
				//
				// The id arm here is passed UNTRIMMED (rawValue, not the already-trimmed `text`) -
				// resolveChoiceOption trims it before comparing (#30, owner decision 2026-08-22,
				// recorded on tallyfy/middleware#240: the id pass tolerates surrounding whitespace
				// in every branch, matching what the text passes already did). Before #30, " 2 "
				// threw here because the id arm compared untrimmed and never matched; it now
				// resolves to option id 2 exactly as the text arms already did for padded text.
				// That is an intended behaviour change, not a regression - see #30.
				const opt = resolveChoiceOption(options, text, rawValue);
				if (!opt) {
					throw new NodeOperationError(
						this.getNode(),
						`Kickoff field "${label}": no dropdown option matches "${String(rawValue)}"`,
						{ itemIndex },
					);
				}
				return { id: opt.id, text: opt.text };
			}
			if (fieldType === 'multiselect') {
				return splitList(String(rawValue ?? '')).map(text => {
					// Text passes first over the whole option list, then the id pass (#240) - same
					// reasoning as the dropdown branch above. splitList has already trimmed each
					// entry, so both arms see the same trimmed value here, and resolveChoiceOption's
					// own trim of the id arm (#30) is a no-op on top of an already-trimmed string.
					// This branch's behaviour is therefore UNCHANGED by #30 - it already resolved a
					// whitespace-padded id before #30 existed, which is what made the other two
					// branches' inconsistency visible in the first place.
					const opt = resolveChoiceOption(options, text, text);
					if (!opt) {
						throw new NodeOperationError(
							this.getNode(),
							`Kickoff field "${label}": no multiselect option matches "${text}"`,
							{ itemIndex },
						);
					}
					// The API only persists a selected option when `selected: true` is present.
					return { id: opt.id, text: opt.text, selected: true };
				});
			}
			if (fieldType === 'radio') {
				// #178 radio parity. This used to fall through to `return rawValue`, so a value
				// differing from an option only by letter case or surrounding whitespace was sent
				// verbatim and api-v2 rejected it, while the same input succeeded through the
				// Tallyfy CLI, the MCP server and Celigo. That split is the inconsistency #178
				// exists to remove.
				//
				// Deliberately NOT a throw, unlike the dropdown and multiselect branches above.
				// No implementation of this encoder throws on an unmatched radio value, so adding
				// one here would invent a seventh behaviour instead of converging on the existing
				// one. The shape is Celigo's: the option's canonical text on a match, the raw
				// value untouched otherwise, which leaves the api-v2 rejection path exactly as it
				// was. Radio is a bare scalar, not the {id,text} pair dropdown uses.
				if (rawValue === null || rawValue === undefined || rawValue === '') {
					return rawValue;
				}
				// Text passes first over the whole option list, then the id pass (#240). This
				// branch still never trims the TEXT arm itself, but resolveChoiceOption now trims
				// the id arm before comparing (#30), so " 2 " where an option has id: 2 newly
				// resolves to that option's text here too, instead of falling through to the raw
				// padded value api-v2 would reject. The no-match fallback below is untouched: an
				// unmatched radio value still returns raw and still never throws - see the
				// "Deliberately NOT a throw" note above, which #30 does not change.
				const opt = resolveChoiceOption(options, rawValue, rawValue);
				return opt ? opt.text : rawValue;
			}
			// text / textarea / email / date / number -> scalar as-is.
			return rawValue;
		};

		// Small request helper used by the read-modify-write operations (kickoff fields,
		// dropdown options, folder membership for templates) that need more than one call.
		const doRequest = async (
			reqMethod: 'GET' | 'POST' | 'PUT' | 'DELETE',
			reqEndpoint: string,
			reqBody?: IDataObject,
			reqQs?: IDataObject,
		): Promise<IDataObject> => {
			const reqOptions: IHttpRequestOptions = {
				method: reqMethod,
				url: `${baseUrl}${reqEndpoint}`,
				headers: {
					'Accept': 'application/json',
					'Content-Type': 'application/json',
				},
				qs: reqQs || {},
				body: reqBody && Object.keys(reqBody).length ? reqBody : undefined,
			};
			return (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'tallyfyApi',
				reqOptions,
			)) as IDataObject;
		};

		// Kick-off (prerun) values for a launch: resolve each entry against the template's kickoff
		// fields and encode per type into a `prerun` object keyed by the field id (the key the API
		// resolves - alias/timeline_id do NOT resolve and launch would silently 201 with no values
		// stored). Matches middleware start_process.js. Process: Launch sends it straight away; a
		// Launch Process scheduled job stores it, and api-v2 hands it to the same startRun later.
		const buildPrerun = async (
			checklistId: string,
			kickoffEntries: IDataObject[],
			itemIndex: number,
		): Promise<IDataObject> => {
			const tmpl = await doRequest(
				'GET',
				`/organizations/${organizationId}/checklists/${checklistId}`,
				undefined,
				{ with: 'prerun' },
			);
			const tmplData = ((tmpl.data as IDataObject) || tmpl);
			const kickoffFields = ((tmplData.prerun as IDataObject[]) || []);
			const prerun: IDataObject = {};
			for (const entry of kickoffEntries) {
				const key = String(entry.field ?? '').trim();
				const field = kickoffFields.find(
					f => f.id === key || f.alias === key || f.label === key,
				);
				if (!field) {
					throw new NodeOperationError(
						this.getNode(),
						`Kickoff field "${key}" not found on template ${checklistId}. Use the "Get kickoff fields" operation to list valid fields.`,
						{ itemIndex },
					);
				}
				prerun[field.id as string] = encodeKickoffValue(field, entry.value, itemIndex) as
					| IDataObject
					| IDataObject[]
					| string;
			}
			return prerun;
		};

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[] = {};
				let endpoint = '';
				let method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET';
				let body: IDataObject = {};
				const qs: IDataObject = {};
				// Set true by read-modify-write branches that already ran their own requests.
				let skipGenericRequest = false;

				// Blueprint operations
				if (resource === 'blueprint') {
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/checklists`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						
						if (filters.q) qs.q = filters.q;
						if (filters.status) qs.status = filters.status;
						if (filters.tag) qs.tag = filters.tag;
						if (filters.sort) qs.sort = filters.sort;
						
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}`;
						method = 'GET';
					}
					
					if (operation === 'create') {
						endpoint = `/organizations/${organizationId}/checklists`;
						method = 'POST';
						
						body.title = this.getNodeParameter('title', i) as string;
						body.type = this.getNodeParameter('type', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						Object.assign(body, additionalFields);
					}
					
					if (operation === 'update') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}`;
						method = 'PUT';
						
						// Title is required for blueprint updates
						body.title = this.getNodeParameter('title', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						Object.assign(body, additionalFields);
					}
					
					if (operation === 'delete') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}`;
						method = 'DELETE';
					}

					if (operation === 'clone') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/clone`;
						method = 'POST';
						// tenant is the org to clone FROM (same org here); title is the new name.
						body.tenant = organizationId;
						const cloneTitle = this.getNodeParameter('cloneTitle', i, '') as string;
						if (cloneTitle) body.title = cloneTitle;
					}

					if (operation === 'getKickoffFields') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/form-fields`;
						method = 'GET';
					}

					if (operation === 'listSteps') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/steps`;
						method = 'GET';
					}
				}

				// Process operations
				if (resource === 'process') {
					if (operation === 'launch') {
						endpoint = `/organizations/${organizationId}/runs`;
						method = 'POST';

						body.checklist_id = this.getNodeParameter('blueprintId', i) as string;
						body.name = this.getNodeParameter('processName', i) as string;

						// Kick-off (prerun) values, resolved and encoded by buildPrerun above.
						const kickoffValues = this.getNodeParameter('kickoffValues', i, {}) as IDataObject;
						const kickoffEntries = (kickoffValues.values as IDataObject[]) || [];
						if (kickoffEntries.length) {
							body.prerun = await buildPrerun(body.checklist_id as string, kickoffEntries, i);
						}

						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						Object.assign(body, additionalFields);
					}
					
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/runs`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						
						if (filters.q) qs.q = filters.q;
						if (filters.status) qs.status = filters.status;
						if (filters.tag) qs.tag = filters.tag;
						if (filters.sort) qs.sort = filters.sort;
						
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}`;
						method = 'GET';
					}
					
					if (operation === 'update') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}`;
						method = 'PUT';
						
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						Object.assign(body, additionalFields);
					}
					
					if (operation === 'archive') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}`;
						method = 'DELETE';
					}
					
					if (operation === 'getTasks') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}/tasks`;
						method = 'GET';
					}

					if (operation === 'reactivate') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}/activate`;
						method = 'PUT';
					}

					if (operation === 'completeKickoffForm') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}/complete-prerun`;
						method = 'POST';
					}

					if (operation === 'reopenKickoffForm') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}/complete-prerun`;
						method = 'DELETE';
					}
				}

				// Task operations
				if (resource === 'task') {
					if (operation === 'createOneOff') {
						endpoint = `/organizations/${organizationId}/tasks`;
						method = 'POST';
						
						body.title = this.getNodeParameter('title', i) as string;
						body.task_type = this.getNodeParameter('task_type', i) as string;
						body.deadline = this.getNodeParameter('deadline', i) as string;
						
						// Build owners object from additional fields
						body.owners = { users: [], guests: [], groups: [] };
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						
						if (additionalFields.assignUsers) {
							(body.owners as IDataObject).users = (additionalFields.assignUsers as string).split(',').map(id => id.trim());
							delete additionalFields.assignUsers;
						}
						if (additionalFields.assignGuests) {
							(body.owners as IDataObject).guests = (additionalFields.assignGuests as string).split(',').map(email => email.trim());
							delete additionalFields.assignGuests;
						}
						if (additionalFields.assignGroups) {
							(body.owners as IDataObject).groups = (additionalFields.assignGroups as string).split(',').map(id => id.trim());
							delete additionalFields.assignGroups;
						}
						
						Object.assign(body, additionalFields);
					}
					
					if (operation === 'complete') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						// Process tasks complete run-scoped; one-off tasks complete org-scoped (V1).
						const completeProcessId = this.getNodeParameter('processId', i, '') as string;
						if (completeProcessId) {
							endpoint = `/organizations/${organizationId}/runs/${completeProcessId}/completed-tasks`;
						} else {
							endpoint = `/organizations/${organizationId}/completed-tasks`;
						}
						method = 'POST';

						body.task_id = taskId;
						// Approval-type steps require is_approved (true/false); other steps ignore it.
						const approvalDecision = this.getNodeParameter('approvalDecision', i, 'none') as string;
						if (approvalDecision === 'approve') {
							body.is_approved = true;
						} else if (approvalDecision === 'reject') {
							body.is_approved = false;
						}
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						if (additionalFields.comment) {
							body.comment = additionalFields.comment;
						}
					}
					
					if (operation === 'updateProperties') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}`;
						method = 'PUT';
						
						const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;
						
						// Required fields for task update
						body.title = updateFields.title || this.getNodeParameter('title', i) as string;
						body.deadline = updateFields.deadline || this.getNodeParameter('deadline', i) as string;
						
						// Handle assignee updates - owners is required
						body.owners = { users: [], guests: [], groups: [] };
						
						if (updateFields.assignUsers) {
							(body.owners as IDataObject).users = (updateFields.assignUsers as string).split(',').map(id => id.trim());
							delete updateFields.assignUsers;
						}
						if (updateFields.assignGuests) {
							(body.owners as IDataObject).guests = (updateFields.assignGuests as string).split(',').map(email => email.trim());
							delete updateFields.assignGuests;
						}
						if (updateFields.assignGroups) {
							(body.owners as IDataObject).groups = (updateFields.assignGroups as string).split(',').map(id => id.trim());
							delete updateFields.assignGroups;
						}
						
						// Remove the fields we've already handled
						delete updateFields.title;
						delete updateFields.deadline;
						
						Object.assign(body, updateFields);
					}
					
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/tasks`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						
						if (filters.q) qs.q = filters.q;
						if (filters.status) qs.status = filters.status;
						if (filters.tag) qs.tag = filters.tag;
						if (filters.sort) qs.sort = filters.sort;
						
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}`;
						method = 'GET';
					}
					
					if (operation === 'delete') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}`;
						method = 'DELETE';
					}
					
					if (operation === 'clone') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/clone`;
						method = 'POST';
					}

					if (operation === 'getMyTasks') {
						endpoint = `/organizations/${organizationId}/me/tasks`;
						method = 'GET';

						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						if (filters.q) qs.q = filters.q;
						if (filters.status) qs.status = filters.status;
						if (filters.sort) qs.sort = filters.sort;
						if (!returnAll) qs.limit = this.getNodeParameter('limit', i);
					}

					if (operation === 'getUserTasks') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}/tasks`;
						method = 'GET';

						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						if (filters.status) qs.status = filters.status;
						if (filters.sort) qs.sort = filters.sort;
						if (!returnAll) qs.limit = this.getNodeParameter('limit', i);
					}

					if (operation === 'getGuestTasks') {
						const guestId = this.getNodeParameter('guestId', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${guestId}/tasks`;
						method = 'GET';

						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						if (filters.status) qs.status = filters.status;
						if (filters.sort) qs.sort = filters.sort;
						if (!returnAll) qs.limit = this.getNodeParameter('limit', i);
					}

					if (operation === 'reopen') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						// Process tasks reopen run-scoped; one-off tasks reopen org-scoped (V2).
						const reopenProcessId = this.getNodeParameter('processId', i, '') as string;
						if (reopenProcessId) {
							endpoint = `/organizations/${organizationId}/runs/${reopenProcessId}/completed-tasks/${taskId}`;
						} else {
							endpoint = `/organizations/${organizationId}/completed-tasks/${taskId}`;
						}
						method = 'DELETE';
					}

					if (operation === 'getProcessTask') {
						const processId = this.getNodeParameter('processId', i) as string;
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}/tasks/${taskId}`;
						method = 'GET';
					}

					if (operation === 'updateProcessTask') {
						const processId = this.getNodeParameter('processId', i) as string;
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}/tasks/${taskId}`;
						method = 'PUT';

						const f = this.getNodeParameter('updateProcessTaskFields', i) as IDataObject;
						if (f.title) body.title = f.title;
						if (f.summary) body.summary = f.summary;
						if (f.deadline) body.deadline = f.deadline;
						if (f.status) body.status = f.status;
						if (f.position !== undefined && f.position !== '') body.position = f.position;
						if (f.max_assignable !== undefined && f.max_assignable !== '') body.max_assignable = f.max_assignable;
						if (f.taskdata) body.taskdata = asObject(f.taskdata);

						if (f.assignUsers || f.assignGuests || f.assignGroups) {
							const owners: IDataObject = { users: [], guests: [], groups: [] };
							if (f.assignUsers) (owners.users as string[]) = (f.assignUsers as string).split(',').map(id => id.trim());
							if (f.assignGuests) (owners.guests as string[]) = (f.assignGuests as string).split(',').map(email => email.trim());
							if (f.assignGroups) (owners.groups as string[]) = (f.assignGroups as string).split(',').map(id => id.trim());
							body.owners = owners;
						}
					}
				}

				// Form Field operations
				if (resource === 'formField') {
					if (operation === 'getFields') {
						const contextType = this.getNodeParameter('contextType', i) as string;
						
						if (contextType === 'process') {
							const processId = this.getNodeParameter('processId', i) as string;
							endpoint = `/organizations/${organizationId}/runs/${processId}/form-fields`;
						} else {
							const blueprintId = this.getNodeParameter('blueprintId', i) as string;
							endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/form-fields`;
						}
						method = 'GET';
					}
					
					// Set a form field's value. `form_value` is TYPE-DEPENDENT: the API validates it
					// against the capture's field_type (FormValuesValidator) and rejects the wrong
					// shape, so a bare string only works for the scalar types. Dropdown and radio are
					// asymmetric by design: dropdown takes an {id, text} pair, radio takes bare text.
					//
					// PRECONDITION (issue #9): `formFieldId` is the CaptureValue ID of an EXISTING
					// stored value. The member endpoint (PUT /form-field/value) resolves it via
					// `CaptureValue::find($id)` in api-v2 UpdateFormFieldValueRequest::postValidate()
					// (then reads `$capture->capture`) and in FormFieldService::updateValue() with no
					// null-guard and no create-if-missing, so setting a value on a run-level field that
					// has no CaptureValue yet returns HTTP 500 "Attempt to read property `capture` on
					// null". The request shape this node builds is correct; the run-level fix belongs in
					// api-v2 (mirror the guest path's storeOrUpdateFields create-or-update). Tracked by a
					// live tripwire in test/live/Tallyfy.live.test.ts.
					if (operation === 'updateValue') {
						const asGuest = this.getNodeParameter('asGuest', i) as boolean;
						const formFieldId = this.getNodeParameter('formFieldId', i) as string;
						// Defaults to 'text' so workflows saved before this parameter existed keep
						// sending the bare scalar they sent before.
						const fieldType = this.getNodeParameter('fieldType', i, 'text') as string;
						
						if (asGuest) {
							// api-v2 binds {guest} by the guest's code (Guest::getRouteKeyName() is
							// 'code'), so an email never matches and comes back as a 404 (#47).
							const guestCode = String(this.getNodeParameter('guestCode', i, '') ?? '').trim();
							if (!guestCode) {
								throw new NodeOperationError(
									this.getNode(),
									'Guest Code is required when As Guest is on. Use the code from the guest\'s link, not their email.',
									{ itemIndex: i },
								);
							}
							if (guestCode.includes('@')) {
								throw new NodeOperationError(
									this.getNode(),
									'Guest Code looks like an email. The guest route needs the guest\'s access code, the segment between /guest/ and /tasks in their link.',
									{ itemIndex: i },
								);
							}
							endpoint = `/organizations/${organizationId}/guests/${encodeURIComponent(guestCode)}/form-field/value`;
							method = 'POST';
						} else {
							endpoint = `/organizations/${organizationId}/form-field/value`;
							method = 'PUT';
						}
						
						body.id = formFieldId;
						
						if (fieldType === 'dropdown') {
							// Both keys are required and the text must equal the option definition's text.
							const optionId = (this.getNodeParameter('dropdownOptionId', i, '') as string).trim();
							body.form_value = {
								// Options written through this node are numbered ({ id: index + 1 }), so send a
								// whole-number id back as a number and leave any other id as the string given.
								id: /^\d+$/.test(optionId) ? Number(optionId) : optionId,
								text: this.getNodeParameter('dropdownOptionText', i, '') as string,
							};
						} else if (fieldType === 'multiselect' || fieldType === 'table' || fieldType === 'file') {
							// multiselect: [{id, text}, ...]; table: one entry per column; file: payload object.
							body.form_value = asJsonValue(this.getNodeParameter('fieldValueJson', i, '[]'));
						} else if (fieldType === 'assignees_form') {
							// {users: [member ids], guests: [emails], groups: [group ids]}. Ids stay strings:
							// the org_group rule requires strings and org_user accepts numeric strings.
							const assignees: IDataObject = {};
							const users = this.getNodeParameter('assigneesUsers', i, '') as string;
							const guests = this.getNodeParameter('assigneesGuests', i, '') as string;
							const groups = this.getNodeParameter('assigneesGroups', i, '') as string;
							if (users) assignees.users = splitList(users);
							if (guests) assignees.guests = splitList(guests);
							if (groups) assignees.groups = splitList(groups);
							body.form_value = assignees;
						} else {
							// text / textarea / email / date / radio all take a bare scalar.
							body.form_value = this.getNodeParameter('fieldValue', i, '') as string;
						}
					}

					// Add a form field (capture) to a template step.
					if (operation === 'addField') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const stepId = this.getNodeParameter('stepId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/steps/${stepId}/captures`;
						method = 'POST';
						body = asObject(this.getNodeParameter('fieldData', i));
					}

					// Update a form field (capture) on a template step (field_type is immutable).
					if (operation === 'updateField') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const stepId = this.getNodeParameter('stepId', i) as string;
						const captureFieldId = this.getNodeParameter('captureFieldId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/steps/${stepId}/captures/${captureFieldId}`;
						method = 'PUT';
						body = asObject(this.getNodeParameter('fieldData', i));
					}

					// Move a form field to another step.
					if (operation === 'moveField') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const stepId = this.getNodeParameter('stepId', i) as string;
						const captureFieldId = this.getNodeParameter('captureFieldId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/steps/${stepId}/captures/${captureFieldId}/move-out`;
						method = 'PUT';
						body.target_step_id = this.getNodeParameter('targetStepId', i) as string;
						body.position = this.getNodeParameter('fieldPosition', i, 1);
					}

					// Delete a form field from a template step.
					if (operation === 'deleteField') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const stepId = this.getNodeParameter('stepId', i) as string;
						const captureFieldId = this.getNodeParameter('captureFieldId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/steps/${stepId}/captures/${captureFieldId}`;
						method = 'DELETE';
					}

					// Read the current options of a choice field (fetches the parent step, extracts the field).
					if (operation === 'getDropdownOptions') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const stepId = this.getNodeParameter('stepId', i) as string;
						const captureFieldId = this.getNodeParameter('captureFieldId', i) as string;
						const stepResp = await doRequest('GET', `/organizations/${organizationId}/checklists/${blueprintId}/steps/${stepId}`);
						const stepData = ((stepResp.data as IDataObject) || stepResp);
						const captures = ((stepData.captures as IDataObject[]) || []);
						const field = captures.find((c: IDataObject) => c.id === captureFieldId);
						responseData = { id: captureFieldId, options: (field ? field.options : []) as IDataObject };
						skipGenericRequest = true;
					}

					// Replace the full options list on a choice field (read the capture, PUT it back with new options).
					if (operation === 'updateDropdownOptions') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const stepId = this.getNodeParameter('stepId', i) as string;
						const captureFieldId = this.getNodeParameter('captureFieldId', i) as string;
						const optionsRaw = this.getNodeParameter('dropdownOptions', i) as string;
						const optionTexts = optionsRaw.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
						const formatted = optionTexts.map((text, idx) => ({ id: idx + 1, text }));

						const stepResp = await doRequest('GET', `/organizations/${organizationId}/checklists/${blueprintId}/steps/${stepId}`);
						const stepData = ((stepResp.data as IDataObject) || stepResp);
						const captures = ((stepData.captures as IDataObject[]) || []);
						const current = captures.find((c: IDataObject) => c.id === captureFieldId);
						if (!current) {
							throw new NodeOperationError(
								this.getNode(),
								`Form field ${captureFieldId} not found in step ${stepId}`,
								{ itemIndex: i },
							);
						}
						const putBody: IDataObject = { ...current };
						delete putBody.id;
						putBody.options = formatted;
						responseData = await doRequest('PUT', `/organizations/${organizationId}/checklists/${blueprintId}/steps/${stepId}/captures/${captureFieldId}`, putBody);
						skipGenericRequest = true;
					}

					// Add a kickoff (prerun) field: read the template, append, PUT it back (V6).
					if (operation === 'addKickoffField') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const fieldData = asObject(this.getNodeParameter('fieldData', i));
						const tmpl = await doRequest('GET', `/organizations/${organizationId}/checklists/${blueprintId}`, undefined, { with: 'prerun' });
						const tmplData = ((tmpl.data as IDataObject) || tmpl);
						const prerun = ((tmplData.prerun as IDataObject[]) || []);
						prerun.push(fieldData);
						responseData = await doRequest('PUT', `/organizations/${organizationId}/checklists/${blueprintId}`, { title: tmplData.title, prerun });
						skipGenericRequest = true;
					}

					// Update a kickoff (prerun) field: read the template, merge changes, PUT it back (V6).
					if (operation === 'updateKickoffField') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const kickoffFieldId = this.getNodeParameter('kickoffFieldId', i) as string;
						const fieldData = asObject(this.getNodeParameter('fieldData', i));
						const tmpl = await doRequest('GET', `/organizations/${organizationId}/checklists/${blueprintId}`, undefined, { with: 'prerun' });
						const tmplData = ((tmpl.data as IDataObject) || tmpl);
						const prerun = ((tmplData.prerun as IDataObject[]) || []);
						const target = prerun.find((f: IDataObject) => f.id === kickoffFieldId);
						if (!target) {
							throw new NodeOperationError(
								this.getNode(),
								`Kickoff field ${kickoffFieldId} not found on template ${blueprintId}`,
								{ itemIndex: i },
							);
						}
						Object.assign(target, fieldData);
						responseData = await doRequest('PUT', `/organizations/${organizationId}/checklists/${blueprintId}`, { title: tmplData.title, prerun });
						skipGenericRequest = true;
					}

					// Delete a kickoff (prerun) field (dedicated endpoint).
					if (operation === 'deleteKickoffField') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const kickoffFieldId = this.getNodeParameter('kickoffFieldId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/preruns/${kickoffFieldId}`;
						method = 'DELETE';
					}

					// Reorder kickoff (prerun) fields by writing explicit positions, then PUT (V6).
					if (operation === 'reorderKickoffField') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const orderRaw = this.getNodeParameter('fieldOrder', i) as string;
						const order = orderRaw.split(',').map(s => s.trim()).filter(Boolean);
						const tmpl = await doRequest('GET', `/organizations/${organizationId}/checklists/${blueprintId}`, undefined, { with: 'prerun' });
						const tmplData = ((tmpl.data as IDataObject) || tmpl);
						const prerun = ((tmplData.prerun as IDataObject[]) || []);
						const byId: IDataObject = {};
						for (const f of prerun) {
							if (f.id) byId[f.id as string] = f;
						}
						const reordered: IDataObject[] = [];
						let pos = 1;
						for (const fid of order) {
							const item = byId[fid] as IDataObject;
							if (!item) {
								throw new NodeOperationError(
									this.getNode(),
									`Kickoff field ${fid} not found on template ${blueprintId}`,
									{ itemIndex: i },
								);
							}
							item.position = pos++;
							reordered.push(item);
							delete byId[fid];
						}
						// Append any fields the caller omitted, continuing the position sequence.
						for (const f of prerun) {
							if (f.id && byId[f.id as string]) {
								f.position = pos++;
								reordered.push(f);
							}
						}
						responseData = await doRequest('PUT', `/organizations/${organizationId}/checklists/${blueprintId}`, { title: tmplData.title, prerun: reordered });
						skipGenericRequest = true;
					}
				}

				// Comment operations
				if (resource === 'comment') {
					const taskId = this.getNodeParameter('taskId', i, '') as string;
					
					if (operation === 'create') {
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/comment`;
						method = 'POST';
						body.content = this.getNodeParameter('content', i) as string;
					}
					
					if (operation === 'createBot') {
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/bot-comment`;
						method = 'POST';
						body.content = this.getNodeParameter('content', i) as string;
					}
					
					if (operation === 'reportProblem') {
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/problem`;
						method = 'POST';
						body.content = this.getNodeParameter('content', i) as string;
					}
					
					if (operation === 'resolveIssue') {
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/resolved-threads`;
						method = 'POST';
						// Resolve issue requires both thread_id and content
						body.thread_id = this.getNodeParameter('threadId', i) as string;
						body.content = this.getNodeParameter('content', i) as string;
					}
					
					if (operation === 'update') {
						const commentId = this.getNodeParameter('commentId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/comment/${commentId}`;
						method = 'PUT';
						body.content = this.getNodeParameter('content', i) as string;
					}
					
					if (operation === 'delete') {
						const commentId = this.getNodeParameter('commentId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/comment/${commentId}`;
						method = 'DELETE';
					}

					// List all comments/threads on a process task (embedded via with=threads).
					if (operation === 'list') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}/tasks/${taskId}`;
						method = 'GET';
						qs.with = 'threads';
					}
				}

				// User operations
				if (resource === 'user') {
					if (operation === 'getCurrent') {
						endpoint = '/me';
						method = 'GET';
					}
					
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/users`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						
						if (filters.q) qs.q = filters.q;
						if (filters.sort) qs.sort = filters.sort;
						
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}`;
						method = 'GET';
					}
					
					if (operation === 'invite') {
						endpoint = `/organizations/${organizationId}/users/invite`;
						method = 'POST';
						
						body.email = this.getNodeParameter('email', i) as string;
						body.first_name = this.getNodeParameter('firstName', i) as string;
						body.last_name = this.getNodeParameter('lastName', i) as string;
						body.role = this.getNodeParameter('role', i) as string;
						body.message = this.getNodeParameter('message', i) as string;
					}
					
					if (operation === 'updateRole') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}/role`;
						method = 'PUT';
						body.role = this.getNodeParameter('role', i) as string;
					}
					
					if (operation === 'disable') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}/disable`;
						method = 'DELETE';
					}
					
					if (operation === 'enable') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}/enable`;
						method = 'PUT';
					}
					
					if (operation === 'convertToGuest') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}/to/guest`;
						method = 'PUT';
					}

					if (operation === 'getOrganization') {
						endpoint = `/organizations/${organizationId}`;
						method = 'GET';
					}
				}

				// Guest operations
				if (resource === 'guest') {
					if (operation === 'create') {
						endpoint = `/organizations/${organizationId}/guests`;
						method = 'POST';
						
						body.email = this.getNodeParameter('email', i) as string;
						const firstName = this.getNodeParameter('firstName', i, '') as string;
						const lastName = this.getNodeParameter('lastName', i, '') as string;
						if (firstName) body.first_name = firstName;
						if (lastName) body.last_name = lastName;
					}
					
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/guests`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						
						if (filters.q) qs.q = filters.q;
						if (filters.sort) qs.sort = filters.sort;
						
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const email = this.getNodeParameter('email', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${email}`;
						method = 'GET';
					}
					
					if (operation === 'update') {
						const email = this.getNodeParameter('email', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${email}`;
						method = 'PUT';
						
						const firstName = this.getNodeParameter('firstName', i, '') as string;
						const lastName = this.getNodeParameter('lastName', i, '') as string;
						if (firstName) body.first_name = firstName;
						if (lastName) body.last_name = lastName;
					}
					
					if (operation === 'delete') {
						const email = this.getNodeParameter('email', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${email}`;
						method = 'DELETE';
					}
					
					if (operation === 'convertToMember') {
						const email = this.getNodeParameter('email', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${email}/to/member`;
						method = 'POST';
					}

					if (operation === 'enable') {
						const email = this.getNodeParameter('email', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${email}/enable`;
						method = 'PUT';
					}

					if (operation === 'disable') {
						const email = this.getNodeParameter('email', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${email}/disable`;
						method = 'DELETE';
					}
				}

				// Group operations
				if (resource === 'group') {
					if (operation === 'create') {
						endpoint = `/organizations/${organizationId}/groups`;
						method = 'POST';
						
						body.name = this.getNodeParameter('name', i) as string;
						body.description = this.getNodeParameter('description', i, '') as string;
						
						const members = this.getNodeParameter('members', i, '') as string;
						const guests = this.getNodeParameter('guests', i, '') as string;
						
						if (members) {
							body.members = members.split(',').map(id => id.trim());
						}
						if (guests) {
							body.guests = guests.split(',').map(email => email.trim());
						}
					}
					
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/groups`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const groupId = this.getNodeParameter('groupId', i) as string;
						endpoint = `/organizations/${organizationId}/groups/${groupId}`;
						method = 'GET';
					}
					
					if (operation === 'update') {
						const groupId = this.getNodeParameter('groupId', i) as string;
						endpoint = `/organizations/${organizationId}/groups/${groupId}`;
						method = 'PUT';
						
						const description = this.getNodeParameter('description', i, '') as string;
						const members = this.getNodeParameter('members', i, '') as string;
						const guests = this.getNodeParameter('guests', i, '') as string;
						
						if (description) body.description = description;
						if (members) body.members = members.split(',').map(id => id.trim());
						if (guests) body.guests = guests.split(',').map(email => email.trim());
					}
					
					if (operation === 'delete') {
						const groupId = this.getNodeParameter('groupId', i) as string;
						endpoint = `/organizations/${organizationId}/groups/${groupId}`;
						method = 'DELETE';
					}
				}

				// Search operations
				if (resource === 'search') {
					endpoint = `/organizations/${organizationId}/search`;
					method = 'GET';
					
					qs.search = this.getNodeParameter('searchQuery', i) as string;
					
					if (operation === 'global') {
						const searchIn = this.getNodeParameter('searchIn', i) as string[];
						qs.on = searchIn.join(',');
					} else if (operation === 'tasks') {
						qs.on = 'task';
					} else if (operation === 'processes') {
						qs.on = 'process';
					} else if (operation === 'blueprints') {
						qs.on = 'blueprint';
					} else if (operation === 'snippets') {
						qs.on = 'snippet';
					}
					
					qs.per_page = 50;
				}

				// ID Finder operations
				if (resource === 'idFinder') {
					const searchTerm = this.getNodeParameter('searchTerm', i) as string;
					
					if (operation === 'findProcessId') {
						endpoint = `/organizations/${organizationId}/runs`;
						method = 'GET';
						qs.q = searchTerm;
						qs.per_page = 10;
					}
					
					if (operation === 'findTaskId') {
						endpoint = `/organizations/${organizationId}/tasks`;
						method = 'GET';
						qs.q = searchTerm;
						qs.per_page = 10;
					}
					
					if (operation === 'findBlueprintId') {
						endpoint = `/organizations/${organizationId}/checklists`;
						method = 'GET';
						qs.q = searchTerm;
						qs.per_page = 10;
					}
					
					if (operation === 'findFormFieldId') {
						const context = this.getNodeParameter('context', i) as string;
						const contextType = this.getNodeParameter('contextType', i) as string;
						
						if (contextType === 'process') {
							endpoint = `/organizations/${organizationId}/runs/${context}/form-fields`;
						} else {
							endpoint = `/organizations/${organizationId}/checklists/${context}/form-fields`;
						}
						method = 'GET';
					}
					
					if (operation === 'findUserId') {
						endpoint = `/organizations/${organizationId}/users`;
						method = 'GET';
						qs.q = searchTerm;
						qs.per_page = 10;
					}
					
					if (operation === 'findGroupId') {
						endpoint = `/organizations/${organizationId}/groups`;
						method = 'GET';
						qs.q = searchTerm;
						qs.per_page = 10;
					}
				}

				// Tag operations
				if (resource === 'tag') {
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/tags`;
						method = 'GET';

						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						if (filters.q) qs.q = filters.q;
						if (filters.status) qs.status = filters.status;
						if (filters.sort) qs.sort = filters.sort;
						if (!returnAll) qs.limit = this.getNodeParameter('limit', i);
					}

					if (operation === 'create') {
						endpoint = `/organizations/${organizationId}/tags`;
						method = 'POST';
						body.title = this.getNodeParameter('tagTitle', i) as string;
						const tagColor = this.getNodeParameter('tagColor', i, '') as string;
						if (tagColor) body.color = tagColor;
					}

					if (operation === 'update') {
						const tagId = this.getNodeParameter('tagId', i) as string;
						endpoint = `/organizations/${organizationId}/tags/${tagId}`;
						method = 'PUT';
						const tagTitle = this.getNodeParameter('tagTitle', i, '') as string;
						const tagColor = this.getNodeParameter('tagColor', i, '') as string;
						if (tagTitle) body.title = tagTitle;
						if (tagColor) body.color = tagColor;
					}

					if (operation === 'delete') {
						const tagId = this.getNodeParameter('tagId', i) as string;
						endpoint = `/organizations/${organizationId}/tags/${tagId}`;
						method = 'DELETE';
					}

					// Tag/untag use ONE association endpoint for both templates and processes (V7).
					if (operation === 'tagTemplate') {
						endpoint = `/organizations/${organizationId}/checklists/tags`;
						method = 'POST';
						body.subject_id = this.getNodeParameter('subjectId', i) as string;
						body.subject_type = 'Checklist';
						body.tag_id = this.getNodeParameter('tagId', i) as string;
						body.tag_type = 'private';
					}

					if (operation === 'tagProcess') {
						endpoint = `/organizations/${organizationId}/checklists/tags`;
						method = 'POST';
						body.subject_id = this.getNodeParameter('subjectId', i) as string;
						body.subject_type = 'Run';
						body.tag_id = this.getNodeParameter('tagId', i) as string;
						body.tag_type = 'private';
					}

					// Untag needs the tag-association id (fetch the object with=tags to find it).
					if (operation === 'untagTemplate' || operation === 'untagProcess') {
						const associationId = this.getNodeParameter('associationId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/tags/${associationId}`;
						method = 'DELETE';
					}
				}

				// Folder operations
				if (resource === 'folder') {
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/folders`;
						method = 'GET';
						qs.folder_type = this.getNodeParameter('folderType', i) as string;
						qs.with = 'children';
						qs.sort = 'position';

						const returnAll = this.getNodeParameter('returnAll', i);
						if (!returnAll) qs.limit = this.getNodeParameter('limit', i);
					}

					if (operation === 'create') {
						endpoint = `/organizations/${organizationId}/folders`;
						method = 'POST';
						body.name = this.getNodeParameter('folderName', i) as string;
						const parentId = this.getNodeParameter('folderParentId', i, '') as string;
						if (parentId) body.parent_id = parentId;
					}

					if (operation === 'update') {
						const folderId = this.getNodeParameter('folderId', i) as string;
						endpoint = `/organizations/${organizationId}/folders/${folderId}`;
						method = 'PUT';
						const folderName = this.getNodeParameter('folderName', i, '') as string;
						const parentId = this.getNodeParameter('folderParentId', i, '') as string;
						if (folderName) body.name = folderName;
						if (parentId) body.parent_id = parentId;
					}

					if (operation === 'delete') {
						const folderId = this.getNodeParameter('folderId', i) as string;
						endpoint = `/organizations/${organizationId}/folders/${folderId}`;
						method = 'DELETE';
					}

					// Add To Folder is asymmetric: templates are foldered on the checklist itself,
					// processes via the add-object endpoint (V8).
					if (operation === 'addToFolder') {
						const folderId = this.getNodeParameter('folderId', i) as string;
						const objectId = this.getNodeParameter('folderObjectId', i) as string;
						const objectType = this.getNodeParameter('folderObjectType', i) as string;
						if (objectType === 'checklist') {
							// The checklist PUT requires title, so fetch it first.
							const tmpl = await doRequest('GET', `/organizations/${organizationId}/checklists/${objectId}`);
							const tmplData = ((tmpl.data as IDataObject) || tmpl);
							responseData = await doRequest('PUT', `/organizations/${organizationId}/checklists/${objectId}`, { title: tmplData.title, folder_id: folderId });
							skipGenericRequest = true;
						} else {
							endpoint = `/organizations/${organizationId}/folders/add-object`;
							method = 'POST';
							body.folder_id = folderId;
							body.subject_id = objectId;
							body.subject_type = 'Run';
						}
					}

					if (operation === 'removeFromFolder') {
						const folderObjectId = this.getNodeParameter('folderRelationId', i) as string;
						endpoint = `/organizations/${organizationId}/folders-objects/${folderObjectId}`;
						method = 'DELETE';
					}
				}

				// Scheduled Job operations (tallyfy/n8n#53). api-v2 calls these recurring jobs. Every
				// operation runs its own requests and outputs the job, or each job or history entry,
				// without the API's `data` envelope.
				if (resource === 'scheduledJob') {
					skipGenericRequest = true;
					const jobsPath = `/organizations/${organizationId}/recurring-jobs`;
					// Annotated on the variable, not the arrow, so TypeScript narrows after a call.
					const fail: (message: string) => never = (message) => {
						throw new NodeOperationError(this.getNode(), message, { itemIndex: i });
					};
					const unwrap = (resp: IDataObject): IDataObject => {
						const inner = resp?.data;
						return inner && typeof inner === 'object' && !Array.isArray(inner) ? (inner as IDataObject) : resp;
					};
					const listOf = (resp: IDataObject): IDataObject[] =>
						Array.isArray(resp?.data) ? (resp.data as IDataObject[]) : [];
					const dayParam = (value: unknown, label: string): string =>
						toScheduleDay(value) ?? fail(`${label} must be a date such as 2026-11-02. Got "${String(value ?? '')}".`);
					const timeParam = (value: unknown, label: string): string =>
						toScheduleTime(value) ??
						fail(`${label} must be a 24 hour time such as 09:00 or 17:30. Got "${String(value ?? '')}".`);
					const weekdaysParam = (value: unknown): number[] => {
						const days = (Array.isArray(value) ? value : [value]).map(Number);
						if (!days.length || days.some(day => !Number.isInteger(day) || day < 1 || day > 7)) {
							fail('Choose at least one day in Days of Week, Monday to Sunday.');
						}
						return days;
					};

					let jobId = '';
					if (SCHEDULED_JOB_ID_OPERATIONS.includes(operation as string)) {
						jobId = String(this.getNodeParameter('scheduledJobId', i) ?? '').trim();
						if (!/^\d+$/.test(jobId)) {
							fail(`Scheduled Job ID must be a whole number, such as 42. Got "${jobId}".`);
						}
					}
					const jobPath = `${jobsPath}/${jobId}`;

					try {
						if (operation === 'getAll') {
							// The API pages with per_page (default 10, at most 100) and page, and reports
							// meta.pagination.current_page and total_pages. It never sends has_more_pages.
							const query: IDataObject = {};
							if (this.getNodeParameter('createdByMe', i, false) as boolean) query.created_by = 'me';
							if (this.getNodeParameter('returnAll', i) as boolean) {
								const jobs: IDataObject[] = [];
								for (let page = 1; ; page++) {
									const resp = await doRequest('GET', jobsPath, undefined, { ...query, per_page: 100, page });
									const rows = listOf(resp);
									jobs.push(...rows);
									const pagination = ((resp.meta as IDataObject)?.pagination as IDataObject) || {};
									const totalPages = Number(pagination.total_pages);
									if (!rows.length || !Number.isFinite(totalPages) || page >= totalPages) break;
								}
								responseData = jobs;
							} else {
								const limit = this.getNodeParameter('limit', i) as number;
								const resp = await doRequest('GET', jobsPath, undefined, { ...query, per_page: limit, page: 1 });
								responseData = listOf(resp).slice(0, limit);
							}
						}

						if (operation === 'get') {
							responseData = unwrap(await doRequest('GET', jobPath));
						}

						if (operation === 'getHistory') {
							responseData = listOf(await doRequest('GET', `${jobPath}/history`));
						}

						if (operation === 'delete') {
							responseData = unwrap(await doRequest('DELETE', jobPath));
						}

						if (operation === 'create') {
							const jobKey = SCHEDULED_JOB_KEYS[this.getNodeParameter('jobType', i) as string];
							if (!jobKey) fail('Job Type must be Create Task or Launch Process.');
							const frequency = this.getNodeParameter('frequency', i) as string;
							const extra = this.getNodeParameter('scheduledJobFields', i, {}) as IDataObject;
							const startDate = dayParam(this.getNodeParameter('startDate', i), 'Start Date');
							const schedule: IDataObject = {
								recurring_type: 'daily',
								interval: 1,
								start_time: timeParam(this.getNodeParameter('startTime', i), 'Start Time'),
							};
							const body: IDataObject = {
								name: this.getNodeParameter('jobName', i) as string,
								start_date: startDate,
							};

							if (frequency === 'once') {
								// The next-gen client's Once job: daily, interval 1, one run. api-v2 reads
								// max_occurrences 1 as a one-time job, whose moment must be in the future.
								if (extra.endDate || extra.maxRuns) {
									fail('End Date and Max Runs apply to Recurring jobs only. A Once job runs one time.');
								}
								body.max_occurrences = 1;
							} else {
								const recurringType = this.getNodeParameter('recurringType', i) as string;
								schedule.recurring_type = recurringType;
								schedule.interval = Number(this.getNodeParameter('interval', i, 1));
								if (recurringType === 'weekly') {
									setScheduleWeekdays(schedule, weekdaysParam(this.getNodeParameter('daysOfWeek', i)));
								}
								if (recurringType === 'monthly') {
									if ((this.getNodeParameter('monthlyOn', i, 'dayOfMonth') as string) === 'weekdayOfMonth') {
										schedule.week_of_month = this.getNodeParameter('weekOfMonth', i) as number;
										setScheduleWeekdays(schedule, weekdaysParam(this.getNodeParameter('weekday', i)));
									} else {
										schedule.day_of_month = this.getNodeParameter('dayOfMonth', i) as number;
									}
									schedule.adjust_to_nearest_date = this.getNodeParameter('adjustToNearestDate', i, false) as boolean;
								}
								if (recurringType === 'yearly') {
									// Named the way api-v2 production fills them in when left out, so a
									// version that requires them reads the same job.
									schedule.month_of_year = Number(startDate.slice(5, 7));
									schedule.day_of_month = Number(startDate.slice(8, 10));
								}
								if (extra.maxRuns !== undefined && extra.maxRuns !== null && extra.maxRuns !== '') {
									const maxRuns = Number(extra.maxRuns);
									if (!Number.isInteger(maxRuns) || maxRuns < 2) {
										fail('Max Runs must be 2 or more for a Recurring job. Choose Once for a job that runs one time.');
									}
									body.max_occurrences = maxRuns;
								}
								if (extra.endDate) body.end_date = dayParam(extra.endDate, 'End Date');
							}
							if (extra.description) body.description = extra.description;
							if (extra.startPaused) body.status = 'paused';

							// The type's id comes from a sequence and differs between environments, so
							// it is looked up by job_key each time (GET recurring-job-types).
							const types = listOf(
								await doRequest('GET', `/organizations/${organizationId}/recurring-job-types`),
							);
							const type = types.find(t => t.job_key === jobKey);
							if (!type) {
								const offered = types.map(t => String(t.job_key)).join(', ') || 'none';
								fail(`This Tallyfy organization does not offer the "${jobKey}" scheduled job type. It offers: ${offered}.`);
							}
							body.recurring_job_type_id = Number(type.id);

							if (jobKey === 'create-task') {
								const options = this.getNodeParameter('taskOptions', i, {}) as IDataObject;
								// Task Options win over Extra Task Data where both name a key.
								const data: IDataObject = { ...asObject(options.extraTaskData) };
								data.title = this.getNodeParameter('taskTitle', i) as string;
								data.task_type = this.getNodeParameter('taskType', i) as string;
								// POST /tasks requires `owners`, and the three empty lists satisfy it.
								data.owners = {
									users: options.assignUsers ? splitList(String(options.assignUsers)) : [],
									guests: options.assignGuests ? splitList(String(options.assignGuests)) : [],
									groups: options.assignGroups ? splitList(String(options.assignGroups)) : [],
								};
								if (frequency === 'once') {
									data.deadline = this.getNodeParameter('taskDeadline', i) as string;
								} else {
									// A repeating task job takes deadline_offset and no fixed deadline
									// (api-v2#10872). The API advertises it in the type's rules, which is
									// how the next-gen client decides to offer repeating task jobs.
									const rules = (type.validations as IDataObject) || {};
									if (!('deadline_offset' in rules)) {
										fail('This Tallyfy version cannot run a task job on a repeating schedule: its create-task rules have no deadline_offset. Choose Once, or Launch Process.');
									}
									data.deadline_offset = {
										value: Number(this.getNodeParameter('deadlineOffsetValue', i)),
										unit: this.getNodeParameter('deadlineOffsetUnit', i) as string,
									};
								}
								for (const key of [
									'can_complete_only_assignees',
									'everyone_must_complete',
									'prevent_guest_comment',
									'separate_task_for_each_assignee',
									'top_secret',
								]) {
									if (options[key] !== undefined) data[key] = options[key];
								}
								if (Number(options.max_assignable) > 0) data.max_assignable = Number(options.max_assignable);
								if (options.run_id) data.run_id = String(options.run_id).trim();
								if (options.started_at) data.started_at = options.started_at;
								if (options.tags) data.tags = splitList(String(options.tags));
								if (options.webhook) data.webhook = options.webhook;
								body.data = data;
							} else {
								const options = this.getNodeParameter('processOptions', i, {}) as IDataObject;
								const data: IDataObject = { ...asObject(options.extraProcessData) };
								data.checklist_id = String(this.getNodeParameter('blueprintId', i) ?? '').trim();
								const processName = this.getNodeParameter('processName', i, '') as string;
								if (processName) data.name = processName;
								const kickoffValues = this.getNodeParameter('kickoffValues', i, {}) as IDataObject;
								const kickoffEntries = (kickoffValues.values as IDataObject[]) || [];
								if (kickoffEntries.length) {
									data.prerun = await buildPrerun(data.checklist_id as string, kickoffEntries, i);
								}
								body.data = data;
							}

							body.schedule = schedule;
							responseData = unwrap(await doRequest('POST', jobsPath, body));
						}

						if (operation === 'update' || operation === 'pause' || operation === 'resume') {
							// The API has no partial update: read the job, change it, send it all back.
							const body = scheduledJobUpdateBody(unwrap(await doRequest('GET', jobPath)));
							const schedule = body.schedule as IDataObject;

							if (operation === 'pause') body.status = 'paused';
							if (operation === 'resume') body.status = 'active';

							if (operation === 'update') {
								const changes = this.getNodeParameter('scheduledJobUpdateFields', i, {}) as IDataObject;
								if (changes.name) body.name = changes.name;
								if (changes.description) body.description = changes.description;
								if (changes.startDate) body.start_date = dayParam(changes.startDate, 'Start Date');
								if (changes.endDate) body.end_date = dayParam(changes.endDate, 'End Date');
								if (changes.startTime) schedule.start_time = timeParam(changes.startTime, 'Start Time');
								if (changes.maxRuns !== undefined) body.max_occurrences = Number(changes.maxRuns);
								if (changes.recurringType) schedule.recurring_type = changes.recurringType;
								if (changes.interval !== undefined) schedule.interval = Number(changes.interval);
								if (changes.daysOfWeek !== undefined) setScheduleWeekdays(schedule, weekdaysParam(changes.daysOfWeek));
								if (changes.dayOfMonth !== undefined) schedule.day_of_month = Number(changes.dayOfMonth);
								if (changes.weekOfMonth !== undefined) schedule.week_of_month = Number(changes.weekOfMonth);
								if (changes.monthOfYear !== undefined) schedule.month_of_year = Number(changes.monthOfYear);
								if (changes.adjustToNearestDate !== undefined) {
									schedule.adjust_to_nearest_date = changes.adjustToNearestDate;
								}
								if (changes.jobData !== undefined) {
									body.data = { ...(body.data as IDataObject), ...asObject(changes.jobData) };
								}
							}

							responseData = unwrap(await doRequest('PUT', jobPath, body));
						}
					} catch (error) {
						// api-v2 answers a job the caller may not manage exactly as one that does not
						// exist (tallyfy/api-v2#10896), so a 404 on a named job says both. DELETE is the
						// one exception on api-v2 production, where it answers 403 for that job
						// (RecurringJobPolicy::authorizeManage, its only refusal); api-v2#11112 makes it
						// 404 too. So both read the same here, whichever version serves the credential.
						const status = httpStatusOf(error);
						if (jobId && (status === 404 || (operation === 'delete' && status === 403))) {
							throw new NodeOperationError(this.getNode(), error as Error, {
								message: scheduledJobNotFoundMessage(jobId),
								itemIndex: i,
								level: 'warning',
							});
						}
						// Anything else goes on as it came: both constructors hand back an error of their
						// own class unchanged, and wrap any other error for this item.
						if (error instanceof NodeApiError) {
							throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
						}
						throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
					}
				}

				// Make the API request (skipped when a read-modify-write branch already ran)
				if (!skipGenericRequest) {
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

				// Every Tallyfy list takes its page size from per_page and ignores limit (measured on
				// staging, #55), so a Limit travels as per_page as well. limit stays in the query as
				// it always was.
				if (qs.limit !== undefined && qs.per_page === undefined) {
					qs.per_page = qs.limit;
				}

				// returnAll walks every page in the loop below, so it must NOT also
				// fire the base request here (that previously double-fetched page 1). See #5.
				// The three task lists offer Return All too, and used to return one page for it (#55).
				if (
					['getAll', 'getMyTasks', 'getUserTasks', 'getGuestTasks'].includes(operation as string) &&
					this.getNodeParameter('returnAll', i)
				) {
					const allItems: IDataObject[] = [];
					let hasMore = true;
					let page = 1;

					while (hasMore) {
						// 100 a page, which every list accepted on staging (#55), so a long list
						// takes a tenth of the requests its default page of 10 would.
						options.qs = { per_page: 100, ...qs, page };
						const pageData = await this.helpers.httpRequestWithAuthentication.call(
							this,
							'tallyfyApi',
							options,
						);

						const rows = Array.isArray(pageData.data) ? (pageData.data as IDataObject[]) : [];
						allItems.push(...rows);

						// The API reports current_page and total_pages and has never sent
						// has_more_pages, which this loop used to wait for, so it stopped after page
						// one (#55). An empty page ends it either way.
						const pagination = (pageData.meta?.pagination ?? {}) as IDataObject;
						const totalPages = Number(pagination.total_pages);
						hasMore =
							rows.length > 0 &&
							(pagination.has_more_pages === true || (Number.isFinite(totalPages) && page < totalPages));
						page++;
					}
					responseData = allItems;
				} else {
					responseData = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'tallyfyApi',
						options,
					);
				}
				}

				// Form field Update Value: since tallyfy/api-v2#8955 both routes answer through the
				// standard transformer, so the value comes back inside `data` and without the row
				// timestamps. Return that data object, so the output is the value whether or not the
				// API serving this credential has #8955 yet (#47).
				if (resource === 'formField' && operation === 'updateValue') {
					const wrapped = (responseData as IDataObject)?.data;
					if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
						responseData = wrapped as IDataObject;
					}
				}

				// Comment list returns the task object with threads embedded; surface the threads
				if (resource === 'comment' && operation === 'list') {
					const taskObj = ((responseData as IDataObject).data as IDataObject) || (responseData as IDataObject);
					const threadsWrapper = (taskObj?.threads as IDataObject) || {};
					responseData = ((threadsWrapper.data as IDataObject[]) || []);
				}

				// Special handling for ID Finder - return simplified results
				if (resource === 'idFinder') {
					let results: IDataObject[] = [];
					if (Array.isArray(responseData)) {
						results = responseData;
					} else if (typeof responseData === 'object' && responseData !== null && 'data' in responseData) {
						results = ((responseData as IDataObject).data as IDataObject[]) || [];
					}
					
					if (results.length > 0) {
						responseData = results.map((item: IDataObject) => ({
							id: item.id,
							name: item.name || item.title || item.label || item.email || 'Unknown',
							type: operation.replace('find', '').replace('Id', ''),
						}));
					}
				}

				// Format response. pairedItem ties every output item back to the input item that
				// produced it, so expressions such as $('Tallyfy').item resolve in later nodes.
				if (Array.isArray(responseData)) {
					returnData.push(...responseData.map(item => ({ json: item, pairedItem: { item: i } })));
				} else {
					returnData.push({ json: responseData, pairedItem: { item: i } });
				}

			} catch (error) {
				// A seat-pool refusal is an actionable business rule, not a transport
				// failure, so rewrite it and let the operator learn WHICH pool is full
				// and what to do. Everything else keeps n8n's own error handling.
				const seatMessage = seatPoolExhaustedMessage(error);
				if (this.continueOnFail()) {
					const errorMessage =
						seatMessage ?? (error instanceof Error ? error.message : String(error));
					returnData.push({ json: { error: errorMessage }, pairedItem: { item: i } });
					continue;
				}
				if (seatMessage) {
					// NodeOperationError, NOT a plain Error. workflow-execute reports a
					// plain non-axios Error to Sentry, so throwing one here would page us
					// on a customer's billing state: the exact opposite of the intent.
					// It also keeps itemIndex, which matters because this node loops over
					// items and a plain Error loses per-item attribution.
					throw new NodeOperationError(this.getNode(), error as Error, {
						message: seatMessage,
						itemIndex: i,
						level: 'warning',
					});
				}
				// An API failure already arrives as a NodeApiError carrying the HTTP status and
				// response, and the NodeApiError constructor hands that same instance back, so this
				// changes nothing about it. Anything else becomes a NodeOperationError tied to the
				// failing item; NodeOperationError likewise hands back an existing one unchanged.
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}