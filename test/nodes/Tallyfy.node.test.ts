import type { INodeExecutionData } from 'n8n-workflow';
import { Tallyfy, seatPoolExhaustedMessage } from '../../nodes/Tallyfy/Tallyfy.node';
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

	describe('Process: Launch with kickoff (prerun) values', () => {
		// The template GET (with=prerun) returns the field defs the node resolves against.
		const templateResp = {
			data: {
				prerun: [
					{ id: 'F_TEXT', alias: 'cust-name', label: 'Cust Name', field_type: 'text' },
					{
						id: 'F_DD',
						alias: 'plan',
						label: 'Plan',
						field_type: 'dropdown',
						options: [
							{ id: 1, text: 'Silver' },
							{ id: 2, text: 'Gold' },
						],
					},
					{
						id: 'F_MS',
						alias: 'addons',
						label: 'Addons',
						field_type: 'multiselect',
						options: [
							{ id: 1, text: 'SSO' },
							{ id: 2, text: 'Audit' },
							{ id: 3, text: 'SLA' },
						],
					},
					{
						id: 'F_RD',
						alias: 'tier',
						label: 'Tier',
						field_type: 'radio',
						options: [
							{ id: 1, text: 'Free' },
							{ id: 2, text: 'Paid' },
						],
					},
				],
			},
		};

		it('resolves each entry (by label/alias/id) and encodes prerun keyed by field id', async () => {
			const { httpMock } = await run(
				{
					resource: 'process',
					operation: 'launch',
					blueprintId: 'BP1',
					processName: 'Kickoff run',
					kickoffValues: {
						values: [
							{ field: 'Cust Name', value: 'Acme Inc' }, // by label -> scalar
							{ field: 'plan', value: 'Gold' }, // by alias -> dropdown {id,text}
							{ field: 'F_MS', value: 'SSO, SLA' }, // by id -> multiselect list
							{ field: 'Tier', value: 'Paid' }, // radio -> bare text
						],
					},
					additionalFields: {},
				},
				[templateResp, { data: { id: 'RUN1' } }],
			);

			// First call fetches the template kickoff fields...
			const tmplReq = requestAt(httpMock, 0);
			expect(tmplReq.method).toBe('GET');
			expect(tmplReq.url).toBe(`${BASE}/organizations/${ORG}/checklists/BP1`);
			expect(tmplReq.qs).toEqual({ with: 'prerun' });

			// ...then the launch POST carries the encoded prerun keyed by field id.
			const launchReq = requestAt(httpMock, 1);
			expect(launchReq.method).toBe('POST');
			expect(launchReq.url).toBe(`${BASE}/organizations/${ORG}/runs`);
			expect(launchReq.body).toEqual({
				checklist_id: 'BP1',
				name: 'Kickoff run',
				prerun: {
					F_TEXT: 'Acme Inc',
					F_DD: { id: 2, text: 'Gold' },
					F_MS: [
						{ id: 1, text: 'SSO', selected: true },
						{ id: 3, text: 'SLA', selected: true },
					],
					F_RD: 'Paid',
				},
			});
		});

		it('does NOT fetch the template or send prerun when no kickoff values are given', async () => {
			const { httpMock } = await run({
				resource: 'process',
				operation: 'launch',
				blueprintId: 'BP1',
				processName: 'Plain run',
				kickoffValues: {},
				additionalFields: {},
			});
			// Exactly one call (the launch); no template pre-fetch, no prerun key.
			expect(httpMock).toHaveBeenCalledTimes(1);
			expect(requestAt(httpMock, 0).body).toEqual({ checklist_id: 'BP1', name: 'Plain run' });
		});

		it('fails loudly when an entry matches no kickoff field', async () => {
			await expect(
				run(
					{
						resource: 'process',
						operation: 'launch',
						blueprintId: 'BP1',
						processName: 'Bad field',
						kickoffValues: { values: [{ field: 'does-not-exist', value: 'x' }] },
						additionalFields: {},
					},
					[templateResp],
				),
			).rejects.toThrow(/not found on template/);
		});

		it('fails loudly when a dropdown option text does not match', async () => {
			await expect(
				run(
					{
						resource: 'process',
						operation: 'launch',
						blueprintId: 'BP1',
						processName: 'Bad option',
						kickoffValues: { values: [{ field: 'Plan', value: 'Platinum' }] },
						additionalFields: {},
					},
					[templateResp],
				),
			).rejects.toThrow(/no dropdown option matches/);
		});

		it('matches a dropdown or multiselect option differing only by case or whitespace (#178) and sends the canonical text', async () => {
			const { httpMock } = await run(
				{
					resource: 'process',
					operation: 'launch',
					blueprintId: 'BP1',
					processName: 'Lenient kickoff',
					kickoffValues: {
						values: [
							{ field: 'plan', value: 'gold' }, // case-only diff -> canonical 'Gold'
							{ field: 'addons', value: ' sso ,SLA' }, // whitespace + case -> canonical 'SSO','SLA'
						],
					},
					additionalFields: {},
				},
				[templateResp, { data: { id: 'RUN2' } }],
			);

			// The launch POST carries each option's OWN canonical text, never the raw input.
			const launchReq = requestAt(httpMock, 1);
			expect(launchReq.body).toEqual({
				checklist_id: 'BP1',
				name: 'Lenient kickoff',
				prerun: {
					F_DD: { id: 2, text: 'Gold' },
					F_MS: [
						{ id: 1, text: 'SSO', selected: true },
						{ id: 3, text: 'SLA', selected: true },
					],
				},
			});
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

	describe('Form Field: Update Value (type-dependent form_value)', () => {
		const base = { resource: 'formField', operation: 'updateValue', formFieldId: 'CV1', asGuest: false };

		it('PUTs a bare scalar and defaults to text when no field type is set', async () => {
			// Backward compatibility: workflows saved before the Field Type param existed
			// carry no fieldType and must keep sending exactly what they sent before.
			const { httpMock } = await run({ ...base, fieldValue: 'Hello' });
			const opts = requestAt(httpMock, 0);
			expect(opts.method).toBe('PUT');
			expect(opts.url).toBe(`${BASE}/organizations/${ORG}/form-field/value`);
			expect(opts.body).toEqual({ id: 'CV1', form_value: 'Hello' });
		});

		it('sends radio as bare option text, not as an object', async () => {
			const { httpMock } = await run({ ...base, fieldType: 'radio', fieldValue: 'Option B' });
			expect(requestAt(httpMock, 0).body).toEqual({ id: 'CV1', form_value: 'Option B' });
		});

		it('sends dropdown as an id and text pair, with a numeric id as a number', async () => {
			const { httpMock } = await run({
				...base,
				fieldType: 'dropdown',
				dropdownOptionId: '2',
				dropdownOptionText: 'Option B',
			});
			expect(requestAt(httpMock, 0).body).toEqual({
				id: 'CV1',
				form_value: { id: 2, text: 'Option B' },
			});
		});

		it('keeps a non-numeric dropdown option id as a string', async () => {
			const { httpMock } = await run({
				...base,
				fieldType: 'dropdown',
				dropdownOptionId: 'opt-a',
				dropdownOptionText: 'Option A',
			});
			expect((requestAt(httpMock, 0).body as Record<string, unknown>).form_value).toEqual({
				id: 'opt-a',
				text: 'Option A',
			});
		});

		it('sends multiselect as a list of option objects, preserving selected flags', async () => {
			const { httpMock } = await run({
				...base,
				fieldType: 'multiselect',
				fieldValueJson: '[{"id":1,"text":"A","selected":true},{"id":2,"text":"B","selected":true}]',
			});
			expect((requestAt(httpMock, 0).body as Record<string, unknown>).form_value).toEqual([
				{ id: 1, text: 'A', selected: true },
				{ id: 2, text: 'B', selected: true },
			]);
		});

		it('sends table rows as a list rather than collapsing them into an object', async () => {
			// The API requires the list length to equal the field's column count, so the
			// array must survive coercion intact.
			const { httpMock } = await run({
				...base,
				fieldType: 'table',
				fieldValueJson: '["Alpha","Beta"]',
			});
			expect((requestAt(httpMock, 0).body as Record<string, unknown>).form_value).toEqual([
				'Alpha',
				'Beta',
			]);
		});

		it('sends assignees as users, guests and groups lists of strings', async () => {
			const { httpMock } = await run({
				...base,
				fieldType: 'assignees_form',
				assigneesUsers: '12, 34',
				assigneesGuests: 'guest@example.com',
				assigneesGroups: 'grp1',
			});
			expect((requestAt(httpMock, 0).body as Record<string, unknown>).form_value).toEqual({
				users: ['12', '34'],
				guests: ['guest@example.com'],
				groups: ['grp1'],
			});
		});

		it('omits empty assignee groups instead of sending empty lists', async () => {
			const { httpMock } = await run({
				...base,
				fieldType: 'assignees_form',
				assigneesUsers: '12',
				assigneesGuests: '',
				assigneesGroups: '',
			});
			expect((requestAt(httpMock, 0).body as Record<string, unknown>).form_value).toEqual({
				users: ['12'],
			});
		});

		it('POSTs to the guest endpoint when As Guest is set', async () => {
			const { httpMock } = await run({
				...base,
				asGuest: true,
				guestEmail: 'guest@example.com',
				fieldType: 'dropdown',
				dropdownOptionId: '1',
				dropdownOptionText: 'Option A',
			});
			const opts = requestAt(httpMock, 0);
			expect(opts.method).toBe('POST');
			expect(opts.url).toBe(`${BASE}/organizations/${ORG}/guests/guest@example.com/form-field/value`);
			expect(opts.body).toEqual({ id: 'CV1', form_value: { id: 1, text: 'Option A' } });
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

	// api-v2 #9206 refuses a seat-consuming action with 409 + a NESTED envelope.
	// Three operations here can hit it: User > Invite / Change Role / Enable.
	// Without the rewrite the operator sees only "409 - Conflict", losing both
	// the reason and pool_type (which decides light vs full seats to buy).
	describe('Seat pool exhausted (api-v2 #9206)', () => {
		const BODY = {
			error: {
				code: 'SEAT_POOL_EXHAUSTED',
				message: 'Your organization has reached its committed full seat limit.',
				details: { pool_type: 'full' },
			},
		};

		/** Shape n8n produces: a NodeApiError wrapping the transport error. */
		function apiError(body: unknown): Error {
			const inner = new Error('409 - Conflict') as Error & { response?: unknown };
			inner.response = { body };
			// `cause` is assigned, not passed to the constructor: that option is
			// ES2022 and this package targets es2019 (see tsconfig.json).
			const outer = new Error('The service was not able to process your request') as Error & {
				cause?: unknown;
			};
			outer.cause = inner;
			return outer;
		}

		const INVITE = {
			resource: 'user',
			operation: 'invite',
			email: 'new@example.com',
			firstName: 'New',
			lastName: 'Person',
			role: 'standard',
			message: 'Welcome aboard',
		};

		it('replaces the generic transport error with the reason and the pool type', async () => {
			const { ctx } = createContextMock({
				params: INVITE,
				httpResponses: [{ __throw: apiError(BODY) }],
			});
			await expect(new Tallyfy().execute.call(ctx)).rejects.toThrow(
				/committed full seat limit[\s\S]*No full seats are left/,
			);
		});

		it('keeps the original error as the cause so nothing is lost', async () => {
			const original = apiError(BODY);
			const { ctx } = createContextMock({
				params: INVITE,
				httpResponses: [{ __throw: original }],
			});
			await expect(new Tallyfy().execute.call(ctx)).rejects.toHaveProperty('cause', original);
		});

		it('uses the readable message on the continueOnFail path too', async () => {
			const { ctx } = createContextMock({
				params: INVITE,
				httpResponses: [{ __throw: apiError(BODY) }],
				continueOnFail: true,
			});
			const result = (await new Tallyfy().execute.call(ctx)) as INodeExecutionData[][];
			expect(result[0][0].json.error).toMatch(/No full seats are left/);
		});

		it('names the light pool when that is the one that is full', async () => {
			const light = {
				error: { ...BODY.error, details: { pool_type: 'light' } },
			};
			const { ctx } = createContextMock({
				params: INVITE,
				httpResponses: [{ __throw: apiError(light) }],
				continueOnFail: true,
			});
			const result = (await new Tallyfy().execute.call(ctx)) as INodeExecutionData[][];
			expect(result[0][0].json.error).toMatch(/No light seats are left/);
		});

		it('leaves every other error exactly as n8n produced it', async () => {
			const { ctx } = createContextMock({
				params: INVITE,
				httpResponses: [{ __throw: new Error('boom') }],
				continueOnFail: true,
			});
			const result = (await new Tallyfy().execute.call(ctx)) as INodeExecutionData[][];
			expect(result[0][0].json).toEqual({ error: 'boom' });
		});
	});

	describe('seatPoolExhaustedMessage (unit)', () => {
		const ENVELOPE = {
			error: {
				code: 'SEAT_POOL_EXHAUSTED',
				message: 'Full seat limit reached.',
				details: { pool_type: 'full' },
			},
		};

		it('finds the envelope when the body is a JSON STRING', () => {
			const err = { cause: { response: { body: JSON.stringify(ENVELOPE) } } };
			expect(seatPoolExhaustedMessage(err)).toMatch(/No full seats are left/);
		});

		it('accepts an already-unwrapped envelope', () => {
			expect(seatPoolExhaustedMessage({ error: ENVELOPE.error })).toMatch(/No full seats are left/);
		});

		it('never renders "undefined seats" when pool_type is missing', () => {
			const err = { error: { code: 'SEAT_POOL_EXHAUSTED', message: 'Nope.' } };
			const msg = seatPoolExhaustedMessage(err)!;
			expect(msg).not.toMatch(/undefined/);
			expect(msg).toMatch(/No available seats are left/);
		});

		it('returns undefined for a different 409 so its own message survives', () => {
			const err = { error: { code: 'SOMETHING_ELSE', message: 'Other conflict.' } };
			expect(seatPoolExhaustedMessage(err)).toBeUndefined();
		});

		it('returns undefined for non-objects and terminates on a cyclic cause', () => {
			expect(seatPoolExhaustedMessage(null)).toBeUndefined();
			expect(seatPoolExhaustedMessage('nope')).toBeUndefined();
			// Self-referential `cause`. If the walk is ever relaxed into `while (node)`
			// this hangs the workflow, so the assertion here is really "it returns".
			const cyclic: Record<string, unknown> = { message: 'x' };
			cyclic.cause = cyclic;
			expect(seatPoolExhaustedMessage(cyclic)).toBeUndefined();
		});

		// The bound is what makes the cyclic case above terminate, so pin its exact
		// value. A cycle can only demonstrate an unbounded walk by hanging; a finite
		// chain proves the same guard while still finishing.
		it('walks four levels of cause and stops', () => {
			const nest = (depth: number): Record<string, unknown> =>
				depth === 0 ? { ...ENVELOPE } : { message: 'wrapper', cause: nest(depth - 1) };

			expect(seatPoolExhaustedMessage(nest(3))).toMatch(/No full seats are left/);
			expect(seatPoolExhaustedMessage(nest(4))).toBeUndefined();
		});
	});
});

describe('Tallyfy node - property definitions', () => {
	// Regression lock for tallyfy/n8n#1: the status filter must offer the process "issue" status
	// (api-v2#5110 / #9466). This is a static description assertion - no credentials or network, so
	// it does NOT depend on an issue-status process existing (that backend is not in production yet).
	it('exposes an "issue" option on the status filter without dropping the existing ones', () => {
		const properties = new Tallyfy().description.properties;
		const filters = properties.find((p) => p.name === 'filters') as
			| { options?: Array<{ name: string; options?: Array<{ value: string }> }> }
			| undefined;
		expect(filters).toBeDefined();

		const statusOption = (filters!.options || []).find((o) => o.name === 'status');
		expect(statusOption).toBeDefined();

		const values = (statusOption!.options || []).map((o) => o.value);
		expect(values).toContain('issue');
		// The pre-existing presets must remain (guards against an accidental removal).
		expect(values).toEqual(
			expect.arrayContaining(['active', 'completed', 'archived', 'draft', 'issue']),
		);
	});
});
