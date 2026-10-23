import type { IDataObject, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import {
	Tallyfy,
	scheduledJobNotFoundMessage,
	toScheduleDay,
	toScheduleTime,
} from '../../nodes/Tallyfy/Tallyfy.node';
import { createContextMock, requestAt } from '../helpers/mocks';

// tallyfy/n8n#53: the Scheduled Job resource. api-v2 calls these recurring jobs. Every shape below
// was read from api-v2 `production` (RecurringJobController, CreateRecurringJobRequest,
// UpdateRecurringJobRequest, ScheduledTaskData, RecurringJobTransformer) on 2026-10-23.

const BASE = 'https://go.tallyfy.com/api';
const ORG = 'ORG123';
const JOBS = `${BASE}/organizations/${ORG}/recurring-jobs`;
const TYPES_URL = `${BASE}/organizations/${ORG}/recurring-job-types`;
/** Mirrors the node identity createContextMock hands back from getNode(). */
const NODE = {
	id: 'test-node',
	name: 'Tallyfy',
	type: 'n8n-nodes-tallyfy.tallyfy',
	typeVersion: 1,
	position: [0, 0] as [number, number],
	parameters: {},
};

/**
 * GET recurring-job-types as production answered it on 2026-10-23: ids as STRINGS, and the
 * create-task rules naming deadline_offset since api-v2#10872.
 */
const TYPES = {
	data: [
		{ id: '2', job_key: 'launch-process', validations: { checklist_id: 'required' } },
		{
			id: '1',
			job_key: 'create-task',
			validations: {
				deadline: 'nullable|is_proper_date',
				deadline_offset: 'nullable|array',
				'deadline_offset.value': 'required_with:deadline_offset|integer|min:1',
				'deadline_offset.unit': 'required_with:deadline_offset|in:minutes,hours,days,weeks,months',
			},
		},
	],
};

/** The same list from an API without api-v2#10872: no deadline_offset rule on create-task. */
const TYPES_WITHOUT_OFFSET = {
	data: [
		{ id: '1', job_key: 'create-task', validations: { deadline: 'required|is_proper_date' } },
		{ id: '2', job_key: 'launch-process', validations: {} },
	],
};

/** A weekly task job as GET recurring-jobs/{id} returns it (RecurringJobTransformer). */
function storedJob(overrides: IDataObject = {}): IDataObject {
	return {
		data: {
			id: 42,
			name: 'Weekly report',
			description: null,
			start_date: '2026-11-02T00:00:00.000000Z',
			end_date: null,
			max_occurrences: null,
			data: {
				title: 'Send the report',
				task_type: 'task',
				owners: { users: [5], guests: [], groups: [] },
				deadline_offset: { value: 1, unit: 'days' },
				created_by: 7,
			},
			status: 'active',
			recurring_job_type_id: 1,
			created_at: '2026-10-23T01:00:00.000000Z',
			updated_at: '2026-10-23T01:00:00.000000Z',
			schedule: {
				id: 9,
				recurring_job_id: 42,
				recurring_type: 'weekly',
				interval: 1,
				adjust_to_nearest_date: false,
				start_time: '09:00:00',
				day_of_week: 1,
				week_of_month: null,
				day_of_month: null,
				month_of_year: null,
			},
			last_run: null,
			...overrides,
		},
	};
}

/** What the update body must carry for storedJob() before any change is applied. */
const STORED_AS_SENT = {
	name: 'Weekly report',
	status: 'active',
	recurring_job_type_id: 1,
	start_date: '2026-11-02',
	data: {
		title: 'Send the report',
		task_type: 'task',
		owners: { users: [5], guests: [], groups: [] },
		deadline_offset: { value: 1, unit: 'days' },
	},
	schedule: {
		recurring_type: 'weekly',
		interval: 1,
		adjust_to_nearest_date: false,
		start_time: '09:00',
		day_of_week: 1,
	},
};

/** The base parameters of a Create Task job; each test overrides what it is about. */
const CREATE_TASK = {
	resource: 'scheduledJob',
	operation: 'create',
	jobName: 'Daily check',
	jobType: 'createTask',
	frequency: 'once',
	startDate: '2026-11-02T00:00:00',
	startTime: '9:00',
	taskTitle: 'Check the queue',
	taskType: 'task',
	taskDeadline: '2026-11-03T17:00:00',
	taskOptions: {},
	scheduledJobFields: {},
};

/**
 * What the node really catches: httpRequestWithAuthentication rethrows an axios failure as
 * `new NodeApiError(node, axiosError)`. Built the same way as the seat-pool tests build theirs.
 */
function apiError(status: number, body: unknown): Error {
	const axiosError = Object.assign(new Error(`Request failed with status code ${status}`), {
		isAxiosError: true,
		response: { status, data: body },
	});
	return new NodeApiError(NODE, axiosError as never);
}

async function run(
	params: Record<string, unknown>,
	httpResponses?: unknown[],
	continueOnFail = false,
): Promise<{ result: INodeExecutionData[][]; httpMock: ReturnType<typeof createContextMock>['httpMock'] }> {
	const { ctx, httpMock } = createContextMock({ params, httpResponses, continueOnFail });
	const result = (await new Tallyfy().execute.call(ctx)) as INodeExecutionData[][];
	return { result, httpMock };
}

/** Run and return what execute() threw, failing the test if it did not throw. */
async function failure(
	params: Record<string, unknown>,
	httpResponses: unknown[],
): Promise<{ thrown: Record<string, unknown> & Error; calls: number }> {
	const { ctx, httpMock } = createContextMock({ params, httpResponses });
	const thrown = await new Tallyfy()
		.execute.call(ctx)
		.then(() => {
			throw new Error('expected execute() to reject');
		})
		.catch((e: unknown) => e as Record<string, unknown> & Error);
	return { thrown, calls: httpMock.mock.calls.length };
}

const jsonOf = (result: INodeExecutionData[][]): IDataObject[] => result[0].map((item) => item.json);

describe('Scheduled Job: Get Many', () => {
	it('GETs /recurring-jobs with per_page set to the limit, and outputs one item per job', async () => {
		const { result, httpMock } = await run(
			{ resource: 'scheduledJob', operation: 'getAll', returnAll: false, limit: 2, createdByMe: false },
			[{ data: [{ id: 1 }, { id: 2 }, { id: 3 }], meta: { pagination: { current_page: 1, total_pages: 1 } } }],
		);
		expect(httpMock).toHaveBeenCalledTimes(1);
		const req = requestAt(httpMock, 0);
		expect(req.method).toBe('GET');
		expect(req.url).toBe(JOBS);
		// The API reads per_page, never limit, so the limit has to travel as per_page.
		expect(req.qs).toEqual({ per_page: 2, page: 1 });
		expect(jsonOf(result)).toEqual([{ id: 1 }, { id: 2 }]);
	});

	it('sends created_by=me when Only Jobs I Created is on', async () => {
		const { httpMock } = await run(
			{ resource: 'scheduledJob', operation: 'getAll', returnAll: false, limit: 10, createdByMe: true },
			[{ data: [], meta: { pagination: { current_page: 1, total_pages: 0 } } }],
		);
		expect(requestAt(httpMock, 0).qs).toEqual({ created_by: 'me', per_page: 10, page: 1 });
	});

	it('walks every page by total_pages when returning all, 100 at a time', async () => {
		const { result, httpMock } = await run(
			{ resource: 'scheduledJob', operation: 'getAll', returnAll: true, createdByMe: true },
			[
				{ data: [{ id: 1 }], meta: { pagination: { current_page: 1, total_pages: 3 } } },
				{ data: [{ id: 2 }], meta: { pagination: { current_page: 2, total_pages: 3 } } },
				{ data: [{ id: 3 }], meta: { pagination: { current_page: 3, total_pages: 3 } } },
			],
		);
		expect(httpMock).toHaveBeenCalledTimes(3);
		expect(requestAt(httpMock, 0).qs).toEqual({ created_by: 'me', per_page: 100, page: 1 });
		expect(requestAt(httpMock, 2).qs).toEqual({ created_by: 'me', per_page: 100, page: 3 });
		expect(jsonOf(result)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
	});

	it('stops after one page when total_pages is 1, and on an empty page', async () => {
		const one = await run(
			{ resource: 'scheduledJob', operation: 'getAll', returnAll: true, createdByMe: false },
			[{ data: [{ id: 1 }], meta: { pagination: { current_page: 1, total_pages: 1 } } }],
		);
		expect(one.httpMock).toHaveBeenCalledTimes(1);
		// A page that comes back empty ends the walk even if total_pages says there are more.
		const empty = await run(
			{ resource: 'scheduledJob', operation: 'getAll', returnAll: true, createdByMe: false },
			[{ data: [], meta: { pagination: { current_page: 1, total_pages: 5 } } }],
		);
		expect(empty.httpMock).toHaveBeenCalledTimes(1);
	});

	it('hides the shared Filters collection, which GET recurring-jobs does not read', () => {
		const filters = new Tallyfy().description.properties.find((p) => p.name === 'filters') as INodeProperties;
		expect(filters.displayOptions?.hide?.resource).toEqual(['scheduledJob']);
		// The other resources still see it.
		expect(filters.displayOptions?.show?.operation).toContain('getAll');
	});
});

describe('Scheduled Job: Get, Get History and Delete', () => {
	it('GETs /recurring-jobs/{id} and outputs the job without its data envelope', async () => {
		const { result, httpMock } = await run(
			{ resource: 'scheduledJob', operation: 'get', scheduledJobId: ' 42 ' },
			[storedJob()],
		);
		const req = requestAt(httpMock, 0);
		expect(req.method).toBe('GET');
		expect(req.url).toBe(`${JOBS}/42`);
		expect(jsonOf(result)).toEqual([storedJob().data]);
	});

	it('GETs /recurring-jobs/{id}/history and outputs one item per run', async () => {
		const runs = [
			{ success: true, message: null, created_at: '2026-10-20T09:00:00.000000Z' },
			{ success: false, message: 'Template not found', created_at: '2026-10-21T09:00:00.000000Z' },
		];
		const { result, httpMock } = await run(
			{ resource: 'scheduledJob', operation: 'getHistory', scheduledJobId: '42' },
			[{ data: runs }],
		);
		expect(requestAt(httpMock, 0).method).toBe('GET');
		expect(requestAt(httpMock, 0).url).toBe(`${JOBS}/42/history`);
		expect(jsonOf(result)).toEqual(runs);
	});

	it('DELETEs /recurring-jobs/{id} and outputs the deleted job', async () => {
		const { result, httpMock } = await run(
			{ resource: 'scheduledJob', operation: 'delete', scheduledJobId: '42' },
			[storedJob()],
		);
		expect(requestAt(httpMock, 0).method).toBe('DELETE');
		expect(requestAt(httpMock, 0).url).toBe(`${JOBS}/42`);
		expect(requestAt(httpMock, 0).body).toBeUndefined();
		expect(jsonOf(result)).toEqual([storedJob().data]);
	});

	it('refuses a job ID that is not a whole number before calling the API', async () => {
		const { thrown, calls } = await failure(
			{ resource: 'scheduledJob', operation: 'get', scheduledJobId: 'abc' },
			[storedJob()],
		);
		expect(thrown).toBeInstanceOf(NodeOperationError);
		expect(thrown.message).toBe('Scheduled Job ID must be a whole number, such as 42. Got "abc".');
		expect(calls).toBe(0);
	});
});

describe('Scheduled Job: Create a task job', () => {
	it('sends a Once task job as daily, one run, with a fixed deadline and the type id looked up by job_key', async () => {
		const { result, httpMock } = await run(
			{ ...CREATE_TASK, taskOptions: { assignUsers: '5, 6' } },
			[TYPES, { data: { id: 77, name: 'Daily check' } }],
		);
		expect(httpMock).toHaveBeenCalledTimes(2);
		expect(requestAt(httpMock, 0).method).toBe('GET');
		expect(requestAt(httpMock, 0).url).toBe(TYPES_URL);

		const req = requestAt(httpMock, 1);
		expect(req.method).toBe('POST');
		expect(req.url).toBe(JOBS);
		expect(req.body).toEqual({
			name: 'Daily check',
			start_date: '2026-11-02',
			max_occurrences: 1,
			// The id arrives as the string "1" and is sent as the number the rule expects.
			recurring_job_type_id: 1,
			data: {
				title: 'Check the queue',
				task_type: 'task',
				owners: { users: ['5', '6'], guests: [], groups: [] },
				deadline: '2026-11-03T17:00:00',
			},
			schedule: { recurring_type: 'daily', interval: 1, start_time: '09:00' },
		});
		expect(jsonOf(result)).toEqual([{ id: 77, name: 'Daily check' }]);
	});

	it('sends a Recurring task job with deadline_offset, no fixed deadline, and both weekday keys', async () => {
		const { httpMock } = await run(
			{
				...CREATE_TASK,
				frequency: 'recurring',
				recurringType: 'weekly',
				interval: 2,
				daysOfWeek: [5, 1, 3],
				deadlineOffsetValue: 2,
				deadlineOffsetUnit: 'days',
				taskOptions: {
					assignGroups: 'G1',
					everyone_must_complete: true,
					max_assignable: 3,
					run_id: ' RUN1 ',
					tags: 'TAG1,TAG2',
					extraTaskData: '{"form_fields":[{"label":"Notes","field_type":"text","required":false}],"title":"loses"}',
				},
				scheduledJobFields: {
					description: 'Every other week',
					endDate: '2027-06-30T00:00:00',
					maxRuns: 10,
					startPaused: true,
				},
			},
			[TYPES, { data: { id: 78 } }],
		);
		expect(requestAt(httpMock, 1).body).toEqual({
			name: 'Daily check',
			start_date: '2026-11-02',
			max_occurrences: 10,
			end_date: '2027-06-30',
			description: 'Every other week',
			status: 'paused',
			recurring_job_type_id: 1,
			data: {
				form_fields: [{ label: 'Notes', field_type: 'text', required: false }],
				// Task Title wins over the same key in Extra Task Data.
				title: 'Check the queue',
				task_type: 'task',
				owners: { users: [], guests: [], groups: ['G1'] },
				deadline_offset: { value: 2, unit: 'days' },
				everyone_must_complete: true,
				max_assignable: 3,
				run_id: 'RUN1',
				tags: ['TAG1', 'TAG2'],
			},
			// days_of_week for an API with api-v2#8974, day_of_week (the earliest) for one without.
			schedule: { recurring_type: 'weekly', interval: 2, start_time: '09:00', days_of_week: [1, 3, 5], day_of_week: 1 },
		});
		expect((requestAt(httpMock, 1).body as IDataObject).data).not.toHaveProperty('deadline');
	});

	it('sends a monthly job on a weekday of the month with week_of_month and that one weekday', async () => {
		const { httpMock } = await run(
			{
				...CREATE_TASK,
				frequency: 'recurring',
				recurringType: 'monthly',
				interval: 1,
				monthlyOn: 'weekdayOfMonth',
				weekOfMonth: 2,
				weekday: 2,
				adjustToNearestDate: true,
				deadlineOffsetValue: 1,
				deadlineOffsetUnit: 'weeks',
			},
			[TYPES, { data: {} }],
		);
		expect((requestAt(httpMock, 1).body as IDataObject).schedule).toEqual({
			recurring_type: 'monthly',
			interval: 1,
			start_time: '09:00',
			week_of_month: 2,
			days_of_week: [2],
			day_of_week: 2,
			adjust_to_nearest_date: true,
		});
	});

	it('sends a monthly job on a day of the month, and a yearly one on the start date month and day', async () => {
		const monthly = await run(
			{
				...CREATE_TASK,
				frequency: 'recurring',
				recurringType: 'monthly',
				interval: 1,
				monthlyOn: 'dayOfMonth',
				dayOfMonth: 15,
				deadlineOffsetValue: 1,
				deadlineOffsetUnit: 'days',
			},
			[TYPES, { data: {} }],
		);
		expect((requestAt(monthly.httpMock, 1).body as IDataObject).schedule).toEqual({
			recurring_type: 'monthly',
			interval: 1,
			start_time: '09:00',
			day_of_month: 15,
			adjust_to_nearest_date: false,
		});

		const yearly = await run(
			{
				...CREATE_TASK,
				frequency: 'recurring',
				recurringType: 'yearly',
				interval: 1,
				deadlineOffsetValue: 1,
				deadlineOffsetUnit: 'months',
			},
			[TYPES, { data: {} }],
		);
		expect((requestAt(yearly.httpMock, 1).body as IDataObject).schedule).toEqual({
			recurring_type: 'yearly',
			interval: 1,
			start_time: '09:00',
			month_of_year: 11,
			day_of_month: 2,
		});
	});

	it('refuses a Recurring task job when the API offers no deadline_offset rule, and creates nothing', async () => {
		const { thrown, calls } = await failure(
			{
				...CREATE_TASK,
				frequency: 'recurring',
				recurringType: 'daily',
				interval: 1,
				deadlineOffsetValue: 1,
				deadlineOffsetUnit: 'days',
			},
			[TYPES_WITHOUT_OFFSET, { data: {} }],
		);
		expect(thrown).toBeInstanceOf(NodeOperationError);
		expect(thrown.message).toMatch(/cannot run a task job on a repeating schedule/);
		// The types lookup only; no POST.
		expect(calls).toBe(1);
	});

	it('still creates a Once task job on that API, which needs no deadline_offset', async () => {
		const { httpMock } = await run(CREATE_TASK, [TYPES_WITHOUT_OFFSET, { data: {} }]);
		expect(requestAt(httpMock, 1).method).toBe('POST');
	});

	it('names the job types the organization does offer when the chosen one is missing', async () => {
		const { thrown, calls } = await failure(CREATE_TASK, [
			{ data: [{ id: '2', job_key: 'launch-process', validations: {} }] },
		]);
		expect(thrown.message).toBe(
			'This Tallyfy organization does not offer the "create-task" scheduled job type. It offers: launch-process.',
		);
		expect(calls).toBe(1);
	});

	it.each([
		[
			'End Date on a Once job',
			{ ...CREATE_TASK, scheduledJobFields: { endDate: '2027-01-01' } },
			'End Date and Max Runs apply to Recurring jobs only. A Once job runs one time.',
		],
		[
			'a start time that is not HH:mm',
			{ ...CREATE_TASK, startTime: '9am' },
			'Start Time must be a 24 hour time such as 09:00 or 17:30. Got "9am".',
		],
		[
			'a start date that names no day',
			{ ...CREATE_TASK, startDate: 'next Tuesday' },
			'Start Date must be a date such as 2026-11-02. Got "next Tuesday".',
		],
		[
			'a weekly job with no day chosen',
			{
				...CREATE_TASK,
				frequency: 'recurring',
				recurringType: 'weekly',
				interval: 1,
				daysOfWeek: [],
				deadlineOffsetValue: 1,
				deadlineOffsetUnit: 'days',
			},
			'Choose at least one day in Days of Week, Monday to Sunday.',
		],
		[
			'Max Runs of 1 on a Recurring job',
			{
				...CREATE_TASK,
				frequency: 'recurring',
				recurringType: 'daily',
				interval: 1,
				deadlineOffsetValue: 1,
				deadlineOffsetUnit: 'days',
				scheduledJobFields: { maxRuns: 1 },
			},
			'Max Runs must be 2 or more for a Recurring job. Choose Once for a job that runs one time.',
		],
	])('refuses %s before calling the API', async (_label, params, message) => {
		const { thrown, calls } = await failure(params, [TYPES, { data: {} }]);
		expect(thrown).toBeInstanceOf(NodeOperationError);
		expect(thrown.message).toBe(message);
		expect((thrown.context as Record<string, unknown>).itemIndex).toBe(0);
		expect(calls).toBe(0);
	});
});

describe('Scheduled Job: Create a launch job', () => {
	const TEMPLATE = {
		data: {
			prerun: [
				{
					id: 'F_DD',
					label: 'Plan',
					field_type: 'dropdown',
					options: [
						{ id: 1, text: 'Silver' },
						{ id: 2, text: 'Gold' },
					],
				},
				{ id: 'F_TXT', label: 'Customer', field_type: 'text' },
			],
		},
	};

	it('stores checklist_id, name and kickoff values encoded as Process: Launch encodes them', async () => {
		const { httpMock } = await run(
			{
				resource: 'scheduledJob',
				operation: 'create',
				jobName: 'Monday onboarding',
				jobType: 'launchProcess',
				frequency: 'recurring',
				recurringType: 'daily',
				interval: 1,
				startDate: '2026-11-02',
				startTime: '08:30',
				blueprintId: ' BP1 ',
				processName: 'Onboarding',
				kickoffValues: { values: [{ field: 'Plan', value: 'gold' }, { field: 'F_TXT', value: 'Acme' }] },
				processOptions: { extraProcessData: '{"starred":true}' },
				scheduledJobFields: {},
			},
			[TYPES, TEMPLATE, { data: { id: 79 } }],
		);
		expect(requestAt(httpMock, 1).url).toBe(`${BASE}/organizations/${ORG}/checklists/BP1`);
		expect(requestAt(httpMock, 1).qs).toEqual({ with: 'prerun' });
		expect(requestAt(httpMock, 2).body).toEqual({
			name: 'Monday onboarding',
			start_date: '2026-11-02',
			recurring_job_type_id: 2,
			data: {
				starred: true,
				checklist_id: 'BP1',
				name: 'Onboarding',
				prerun: { F_DD: { id: 2, text: 'Gold' }, F_TXT: 'Acme' },
			},
			schedule: { recurring_type: 'daily', interval: 1, start_time: '08:30' },
		});
	});

	it('fetches no template when no kickoff values are given', async () => {
		const { httpMock } = await run(
			{
				resource: 'scheduledJob',
				operation: 'create',
				jobName: 'Launch',
				jobType: 'launchProcess',
				frequency: 'once',
				startDate: '2026-11-02',
				startTime: '08:30',
				blueprintId: 'BP1',
				processName: '',
				kickoffValues: {},
				processOptions: {},
				scheduledJobFields: {},
			},
			[TYPES, { data: {} }],
		);
		expect(httpMock).toHaveBeenCalledTimes(2);
		expect((requestAt(httpMock, 1).body as IDataObject).data).toEqual({ checklist_id: 'BP1' });
		expect((requestAt(httpMock, 1).body as IDataObject).max_occurrences).toBe(1);
	});

	it('fails with the Process: Launch message when a kickoff entry names no field', async () => {
		const { thrown, calls } = await failure(
			{
				resource: 'scheduledJob',
				operation: 'create',
				jobName: 'Launch',
				jobType: 'launchProcess',
				frequency: 'once',
				startDate: '2026-11-02',
				startTime: '08:30',
				blueprintId: 'BP1',
				processName: '',
				kickoffValues: { values: [{ field: 'nope', value: 'x' }] },
				processOptions: {},
				scheduledJobFields: {},
			},
			[TYPES, TEMPLATE],
		);
		expect(thrown.message).toBe(
			'Kickoff field "nope" not found on template BP1. Use the "Get kickoff fields" operation to list valid fields.',
		);
		// Types and template, then it stops: nothing is created.
		expect(calls).toBe(2);
	});
});

describe('Scheduled Job: Update, Pause and Resume read the job and send it all back', () => {
	it('PAUSE sends the stored job with status paused, cleaned of what the update rules refuse', async () => {
		const { result, httpMock } = await run(
			{ resource: 'scheduledJob', operation: 'pause', scheduledJobId: '42' },
			[storedJob(), storedJob({ status: 'paused' })],
		);
		expect(httpMock).toHaveBeenCalledTimes(2);
		expect(requestAt(httpMock, 0).method).toBe('GET');
		expect(requestAt(httpMock, 0).url).toBe(`${JOBS}/42`);
		const put = requestAt(httpMock, 1);
		expect(put.method).toBe('PUT');
		expect(put.url).toBe(`${JOBS}/42`);
		// No nulls (description, end_date, max_occurrences, schedule keys), no created_by, the day
		// without its time, and start_time without seconds.
		expect(put.body).toEqual({ ...STORED_AS_SENT, status: 'paused' });
		expect(jsonOf(result)[0].status).toBe('paused');
	});

	it('RESUME sends the stored job with status active', async () => {
		const { httpMock } = await run(
			{ resource: 'scheduledJob', operation: 'resume', scheduledJobId: '42' },
			[storedJob({ status: 'paused' }), storedJob()],
		);
		expect(requestAt(httpMock, 1).body).toEqual({ ...STORED_AS_SENT, status: 'active' });
	});

	it('sends days_of_week back as stored by an API with api-v2#8974', async () => {
		const stored = storedJob();
		const job = stored.data as IDataObject;
		job.schedule = { ...(job.schedule as IDataObject), day_of_week: undefined, days_of_week: [1, 4] };
		const { httpMock } = await run(
			{ resource: 'scheduledJob', operation: 'pause', scheduledJobId: '42' },
			[stored, stored],
		);
		expect((requestAt(httpMock, 1).body as IDataObject).schedule).toEqual({
			recurring_type: 'weekly',
			interval: 1,
			adjust_to_nearest_date: false,
			start_time: '09:00',
			days_of_week: [1, 4],
		});
	});

	it('UPDATE lays the changes over the stored job, merging Data (JSON) into the stored data', async () => {
		const { httpMock } = await run(
			{
				resource: 'scheduledJob',
				operation: 'update',
				scheduledJobId: '42',
				scheduledJobUpdateFields: {
					name: 'Renamed',
					startTime: '7:45',
					daysOfWeek: [4, 2],
					maxRuns: 6,
					endDate: '2027-01-31T00:00:00',
					jobData: '{"title":"New title"}',
				},
			},
			[storedJob(), storedJob()],
		);
		expect(requestAt(httpMock, 1).body).toEqual({
			...STORED_AS_SENT,
			name: 'Renamed',
			max_occurrences: 6,
			end_date: '2027-01-31',
			data: { ...STORED_AS_SENT.data, title: 'New title' },
			schedule: { ...STORED_AS_SENT.schedule, start_time: '07:45', day_of_week: 2, days_of_week: [2, 4] },
		});
	});

	it('UPDATE of a finished job sends status completed back, the only status the API accepts for it', async () => {
		const { httpMock } = await run(
			{
				resource: 'scheduledJob',
				operation: 'update',
				scheduledJobId: '42',
				scheduledJobUpdateFields: { name: 'Old report' },
			},
			[storedJob({ status: 'completed', max_occurrences: 4 }), storedJob({ status: 'completed' })],
		);
		expect(requestAt(httpMock, 1).body).toMatchObject({ name: 'Old report', status: 'completed', max_occurrences: 4 });
	});
});

// tallyfy/api-v2#10896: a member asking for a job they may not manage gets the same 404 as for a
// job that does not exist. The node cannot tell the two apart, so its message says both.
describe('Scheduled Job: the 404 for a job that is missing or hidden', () => {
	const MISSING = { message: 'No query results for model [RecurringJob] 42', error: true };

	it('builds its 404 fixture the way n8n does, with the status on the error', () => {
		// If this fails, every test below is testing the wrong failure.
		expect(String((apiError(404, MISSING) as unknown as { httpCode: unknown }).httpCode)).toBe('404');
	});

	it.each(['get', 'getHistory', 'delete', 'update', 'pause', 'resume'])(
		'%s turns a 404 into a warning that says the job is missing or not yours to manage',
		async (operation) => {
			const { thrown, calls } = await failure(
				{ resource: 'scheduledJob', operation, scheduledJobId: '42', scheduledJobUpdateFields: {} },
				[{ __throw: apiError(404, MISSING) }],
			);
			expect(thrown).toBeInstanceOf(NodeOperationError);
			expect(thrown.message).toBe(scheduledJobNotFoundMessage('42'));
			expect(thrown.level).toBe('warning');
			expect((thrown.context as Record<string, unknown>).itemIndex).toBe(0);
			// One request, and for update, pause and resume no PUT after the failed read.
			expect(calls).toBe(1);
		},
	);

	it('says it on the continueOnFail path too', async () => {
		const { result } = await run(
			{ resource: 'scheduledJob', operation: 'get', scheduledJobId: '42' },
			[{ __throw: apiError(404, MISSING) }],
			true,
		);
		expect(result[0][0]).toEqual({
			json: { error: scheduledJobNotFoundMessage('42') },
			pairedItem: { item: 0 },
		});
	});

	it('reads the status the live harness puts on a plain error, statusCode', async () => {
		const plain = Object.assign(new Error('Tallyfy API 404 Not Found'), { statusCode: 404 });
		const { thrown } = await failure(
			{ resource: 'scheduledJob', operation: 'get', scheduledJobId: '42' },
			[{ __throw: plain }],
		);
		expect(thrown.message).toBe(scheduledJobNotFoundMessage('42'));
	});

	it('reads a 403 on Delete the same way, which is how api-v2 production refuses that job', async () => {
		const { thrown } = await failure(
			{ resource: 'scheduledJob', operation: 'delete', scheduledJobId: '42' },
			[{ __throw: apiError(403, { message: 'Permission denied.' }) }],
		);
		expect(thrown.message).toBe(scheduledJobNotFoundMessage('42'));
	});

	it('leaves a 403 on Update alone: there it means the new data names a blueprint or process the user may not use', async () => {
		const refused = apiError(403, { message: 'Permission denied: cannot launch process from this template.' });
		const { thrown, calls } = await failure(
			{
				resource: 'scheduledJob',
				operation: 'update',
				scheduledJobId: '42',
				scheduledJobUpdateFields: { jobData: '{"checklist_id":"OTHER"}' },
			},
			[storedJob(), { __throw: refused }],
		);
		expect(thrown).toBe(refused);
		expect(calls).toBe(2);
	});

	it('leaves a 422 on a named job as the API sent it', async () => {
		const refused = apiError(422, { message: 'This job has finished. Schedule it again as a new job.' });
		const { thrown } = await failure(
			{ resource: 'scheduledJob', operation: 'get', scheduledJobId: '42' },
			[{ __throw: refused }],
		);
		expect(thrown).toBe(refused);
	});

	it('leaves a 404 on Create alone, since no job is named there', async () => {
		const missingTemplate = apiError(404, { message: 'Not found' });
		const { thrown } = await failure(
			{
				resource: 'scheduledJob',
				operation: 'create',
				jobName: 'Launch',
				jobType: 'launchProcess',
				frequency: 'once',
				startDate: '2026-11-02',
				startTime: '08:30',
				blueprintId: 'BP404',
				processName: '',
				kickoffValues: { values: [{ field: 'Plan', value: 'Gold' }] },
				processOptions: {},
				scheduledJobFields: {},
			},
			[TYPES, { __throw: missingTemplate }],
		);
		expect(thrown).toBe(missingTemplate);
	});
});

describe('Scheduled Job: date and time helpers', () => {
	it('toScheduleDay keeps the calendar day written in the value', () => {
		expect(toScheduleDay('2026-11-02')).toBe('2026-11-02');
		expect(toScheduleDay(' 2026-11-02T23:30:00-05:00 ')).toBe('2026-11-02');
		expect(toScheduleDay('2026-11-02T00:00:00.000000Z')).toBe('2026-11-02');
		expect(toScheduleDay(new Date('2026-11-02T12:00:00Z'))).toBe('2026-11-02');
		// A Luxon DateTime, as an n8n expression can hand over.
		expect(toScheduleDay({ toISODate: () => '2026-11-02' })).toBe('2026-11-02');
	});

	it('toScheduleDay returns undefined for anything that names no day', () => {
		for (const bad of ['', 'tomorrow', '2026-13-02', '2026-11-32', null, undefined, 20261102, new Date('nope')]) {
			expect(toScheduleDay(bad)).toBeUndefined();
		}
	});

	it('toScheduleTime pads the hour and drops seconds, as date_format:H:i requires', () => {
		expect(toScheduleTime('9:05')).toBe('09:05');
		expect(toScheduleTime('17:30')).toBe('17:30');
		expect(toScheduleTime('09:00:00')).toBe('09:00');
		for (const bad of ['24:00', '12:60', '9', '9am', '', null, 900]) {
			expect(toScheduleTime(bad)).toBeUndefined();
		}
	});
});

describe('Scheduled Job: description', () => {
	const description = new Tallyfy().description;

	it('offers the resource and its eight operations', () => {
		const resource = description.properties.find((p) => p.name === 'resource') as INodeProperties;
		expect((resource.options as Array<{ value: string }>).map((o) => o.value)).toContain('scheduledJob');
		const operation = description.properties.find(
			(p) => p.name === 'operation' && p.displayOptions?.show?.resource?.includes('scheduledJob'),
		) as INodeProperties;
		expect((operation.options as Array<{ value: string }>).map((o) => o.value)).toEqual([
			'create',
			'delete',
			'get',
			'getHistory',
			'getAll',
			'pause',
			'resume',
			'update',
		]);
	});
});
