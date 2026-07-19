import type { INodeExecutionData } from 'n8n-workflow';
import { Tallyfy } from '../../nodes/Tallyfy/Tallyfy.node';
import { createContextMock, requestAt, credentialAt } from '../helpers/mocks';

const BASE = 'https://go.tallyfy.com/api';
const ORG = 'ORG123';

/** Run the node's execute() with the given params and captured HTTP responses. */
async function run(
	params: Record<string, unknown>,
	httpResponses?: unknown[],
): Promise<{ result: INodeExecutionData[][]; httpMock: ReturnType<typeof createContextMock>['httpMock'] }> {
	const { ctx, httpMock } = createContextMock({ params, httpResponses });
	const result = (await new Tallyfy().execute.call(ctx)) as INodeExecutionData[][];
	return { result, httpMock };
}

describe('Tallyfy node - request building', () => {
	describe('Process: Launch', () => {
		it('POSTs to /runs with checklist_id (not template_id) and name', async () => {
			const { httpMock } = await run({
				resource: 'process',
				operation: 'launch',
				blueprintId: 'BP1',
				processName: 'Q3 Onboarding',
				additionalFields: {},
			});
			const opts = requestAt(httpMock, 0);
			expect(credentialAt(httpMock, 0)).toBe('tallyfyApi');
			expect(opts.method).toBe('POST');
			expect(opts.url).toBe(`${BASE}/organizations/${ORG}/runs`);
			expect(opts.body).toEqual({ checklist_id: 'BP1', name: 'Q3 Onboarding' });
			// Auth + X-Tallyfy-Client are injected by the credential, so per-request headers carry
			// only Accept + Content-Type. The credential test covers the client header.
			expect(opts.headers).toMatchObject({
				Accept: 'application/json',
				'Content-Type': 'application/json',
			});
			expect((opts.headers as Record<string, string>)['X-Tallyfy-Client']).toBeUndefined();
		});
	});

	describe('Task: Complete', () => {
		it('POSTs to org-scoped /completed-tasks with task_id for a one-off task', async () => {
			const { httpMock } = await run({
				resource: 'task',
				operation: 'complete',
				taskId: 'T1',
				additionalFields: {},
			});
			const opts = requestAt(httpMock, 0);
			expect(opts.method).toBe('POST');
			expect(opts.url).toBe(`${BASE}/organizations/${ORG}/completed-tasks`);
			expect(opts.body).toEqual({ task_id: 'T1' });
		});

		it('POSTs to the run-scoped /completed-tasks when a process id is supplied', async () => {
			const { httpMock } = await run({
				resource: 'task',
				operation: 'complete',
				taskId: 'T1',
				processId: 'P9',
				additionalFields: {},
			});
			const opts = requestAt(httpMock, 0);
			expect(opts.url).toBe(`${BASE}/organizations/${ORG}/runs/P9/completed-tasks`);
			expect(opts.body).toEqual({ task_id: 'T1' });
		});

		it('adds is_approved and comment when approving with a note', async () => {
			const { httpMock } = await run({
				resource: 'task',
				operation: 'complete',
				taskId: 'T1',
				approvalDecision: 'approve',
				additionalFields: { comment: 'Looks good' },
			});
			expect(requestAt(httpMock, 0).body).toEqual({
				task_id: 'T1',
				is_approved: true,
				comment: 'Looks good',
			});
		});
	});

	describe('Task: Update Properties', () => {
		it('PUTs /tasks/{id} with title, deadline and owners split from CSV', async () => {
			const { httpMock } = await run({
				resource: 'task',
				operation: 'updateProperties',
				taskId: 'T1',
				updateFields: { title: 'Renamed', deadline: '2026-02-01', assignUsers: 'u1, u2' },
			});
			const opts = requestAt(httpMock, 0);
			expect(opts.method).toBe('PUT');
			expect(opts.url).toBe(`${BASE}/organizations/${ORG}/tasks/T1`);
			expect(opts.body).toMatchObject({
				title: 'Renamed',
				deadline: '2026-02-01',
				owners: { users: ['u1', 'u2'], guests: [], groups: [] },
			});
		});
	});

	describe('ID Finder: Find Task', () => {
		it('GETs /tasks with the search term and simplifies the response to {id,name,type}', async () => {
			const { result, httpMock } = await run(
				{ resource: 'idFinder', operation: 'findTaskId', searchTerm: 'invoice' },
				[{ data: [{ id: 'T9', title: 'Invoice review' }] }],
			);
			const opts = requestAt(httpMock, 0);
			expect(opts.method).toBe('GET');
			expect(opts.url).toBe(`${BASE}/organizations/${ORG}/tasks`);
			expect(opts.qs).toEqual({ q: 'invoice', per_page: 10 });
			expect(result[0][0].json).toEqual({ id: 'T9', name: 'Invoice review', type: 'Task' });
		});
	});

	describe('User: Invite', () => {
		it('POSTs /users/invite with email and role fields', async () => {
			const { httpMock } = await run({
				resource: 'user',
				operation: 'invite',
				email: 'new@example.com',
				firstName: 'New',
				lastName: 'Member',
				role: 'light',
				message: 'Welcome aboard',
			});
			const opts = requestAt(httpMock, 0);
			expect(opts.method).toBe('POST');
			expect(opts.url).toBe(`${BASE}/organizations/${ORG}/users/invite`);
			expect(opts.body).toEqual({
				email: 'new@example.com',
				first_name: 'New',
				last_name: 'Member',
				role: 'light',
				message: 'Welcome aboard',
			});
		});
	});

	describe('Comment: Create', () => {
		it('POSTs /tasks/{id}/comment with content', async () => {
			const { httpMock } = await run({
				resource: 'comment',
				operation: 'create',
				taskId: 'T1',
				content: 'Please review',
			});
			const opts = requestAt(httpMock, 0);
			expect(opts.method).toBe('POST');
			expect(opts.url).toBe(`${BASE}/organizations/${ORG}/tasks/T1/comment`);
			expect(opts.body).toEqual({ content: 'Please review' });
		});
	});

	describe('Comment: Report Problem', () => {
		it('POSTs to the dedicated /problem endpoint (not a type field on /comment)', async () => {
			const { httpMock } = await run({
				resource: 'comment',
				operation: 'reportProblem',
				taskId: 'T1',
				content: 'Something is broken',
			});
			const opts = requestAt(httpMock, 0);
			expect(opts.method).toBe('POST');
			expect(opts.url).toBe(`${BASE}/organizations/${ORG}/tasks/T1/problem`);
			expect(opts.body).toEqual({ content: 'Something is broken' });
		});
	});

	describe('Search: Global', () => {
		it('GETs /search with the query, joined scopes and per_page', async () => {
			const { httpMock } = await run({
				resource: 'search',
				operation: 'global',
				searchQuery: 'contract',
				searchIn: ['task', 'process'],
			});
			const opts = requestAt(httpMock, 0);
			expect(opts.method).toBe('GET');
			expect(opts.url).toBe(`${BASE}/organizations/${ORG}/search`);
			expect(opts.qs).toEqual({ search: 'contract', on: 'task,process', per_page: 50 });
		});
	});

	describe('Blueprint: Get All', () => {
		it('GETs /checklists with filters and a limit when not returning all', async () => {
			const { httpMock } = await run({
				resource: 'blueprint',
				operation: 'getAll',
				returnAll: false,
				filters: { q: 'sales', status: 'active' },
				limit: 25,
			});
			const opts = requestAt(httpMock, 0);
			expect(opts.method).toBe('GET');
			expect(opts.url).toBe(`${BASE}/organizations/${ORG}/checklists`);
			expect(opts.qs).toEqual({ q: 'sales', status: 'active', limit: 25 });
		});

		it('paginates through all pages when returnAll is true', async () => {
			const { result, httpMock } = await run(
				{ resource: 'blueprint', operation: 'getAll', returnAll: true, filters: {} },
				[
					{ data: [{ id: 'a' }], meta: { pagination: { has_more_pages: true } } },
					{ data: [{ id: 'b' }], meta: { pagination: { has_more_pages: false } } },
				],
			);
			// Output is the concatenation of all pages.
			expect(result[0].map((i) => i.json)).toEqual([{ id: 'a' }, { id: 'b' }]);
			// The loop is the only fetch path: page 1 then page 2, with no discarded
			// base request (page 1 is fetched exactly once). Regression lock for #5.
			expect(httpMock).toHaveBeenCalledTimes(2);
			expect(requestAt(httpMock, 0).qs).toMatchObject({ page: 1 });
			expect(requestAt(httpMock, 1).qs).toMatchObject({ page: 2 });
		});
	});

	describe('Tag: Tag Process', () => {
		it('POSTs to the shared /checklists/tags association endpoint with subject_type Run', async () => {
			const { httpMock } = await run({
				resource: 'tag',
				operation: 'tagProcess',
				subjectId: 'P1',
				tagId: 'TAG1',
			});
			const opts = requestAt(httpMock, 0);
			expect(opts.method).toBe('POST');
			expect(opts.url).toBe(`${BASE}/organizations/${ORG}/checklists/tags`);
			expect(opts.body).toEqual({
				subject_id: 'P1',
				subject_type: 'Run',
				tag_id: 'TAG1',
				tag_type: 'private',
			});
		});
	});

	describe('Form Field: Add Field (JSON coercion helper)', () => {
		it('parses a JSON-string fieldData param into the request body', async () => {
			const { httpMock } = await run({
				resource: 'formField',
				operation: 'addField',
				blueprintId: 'BP1',
				stepId: 'S1',
				fieldData: '{"label":"Full name","field_type":"text"}',
			});
			const opts = requestAt(httpMock, 0);
			expect(opts.method).toBe('POST');
			expect(opts.url).toBe(`${BASE}/organizations/${ORG}/checklists/BP1/steps/S1/captures`);
			expect(opts.body).toEqual({ label: 'Full name', field_type: 'text' });
		});
	});

	describe('Error handling', () => {
		it('surfaces the error as JSON when continueOnFail is on', async () => {
			const { ctx, httpMock } = createContextMock({
				params: { resource: 'process', operation: 'get', processId: 'P1' },
				httpResponses: [{ __throw: new Error('boom') }],
				continueOnFail: true,
			});
			const result = (await new Tallyfy().execute.call(ctx)) as INodeExecutionData[][];
			expect(httpMock).toHaveBeenCalledTimes(1);
			expect(result[0][0].json).toEqual({ error: 'boom' });
		});
	});
});
