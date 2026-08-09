/**
 * LIVE integration tests - real HTTP against Tallyfy staging (org "Test Org staging2 1").
 *
 * Gated behind TALLYFY_LIVE=1 so the mocked unit suite still runs with no creds/network:
 *     TALLYFY_LIVE=1 npm test
 *
 * Every test drives the REAL Tallyfy node execute() (see test/helpers/live.ts) so the node's
 * actual request-building and response-handling are exercised against the live API, then asserts a
 * real create -> read -> update -> delete round-trip. All artifacts are prefixed "mwtest-n8n-" and
 * cleaned up (per-test, with a top-level sweeper backstop).
 */
import type { IDataObject } from 'n8n-workflow';
import { LIVE, TEST_ORG, PREFIX, uniq, loadCreds, runLive, rawApi, data } from '../helpers/live';

const d = LIVE ? describe : describe.skip;

jest.setTimeout(120_000);

/** Create a template step (the node has no step operation) so form-field / run-task tests have one. */
async function createStep(blueprintId: string, title: string): Promise<string> {
	const step = await rawApi('POST', `/organizations/${TEST_ORG}/checklists/${blueprintId}/steps`, {
		checklist_id: blueprintId,
		title,
		step_type: 'task',
		position: 1,
	});
	return (data(step) as IDataObject).id as string;
}

d('Tallyfy live API', () => {
	beforeAll(async () => {
		// Fail fast with a clear message if the staging creds are stale/missing.
		const creds = loadCreds();
		expect(creds.accessToken).toBeTruthy();
		const me = await rawApi('GET', '/me');
		expect((data(me) as IDataObject).id).toBeTruthy();
	});

	// Backstop sweeper: remove any leftover mwtest-n8n-* artifacts even if a test threw mid-way.
	afterAll(async () => {
		const sweep = async (
			listPath: string,
			del: (item: IDataObject) => Promise<unknown>,
			qs: IDataObject = { q: PREFIX, per_page: 100 },
		) => {
			try {
				const resp = await rawApi('GET', listPath, undefined, qs);
				const items = (data<IDataObject[]>(resp) as IDataObject[]) || [];
				for (const item of Array.isArray(items) ? items : []) {
					const title = String(item.title || item.name || item.email || '');
					if (title.startsWith(PREFIX)) {
						await del(item).catch(() => undefined);
					}
				}
			} catch {
				/* best-effort */
			}
		};
		// Runs (archive any leftover active/problem run so a mid-test failure self-cleans).
		for (const status of ['active', 'problem']) {
			await sweep(
				`/organizations/${TEST_ORG}/runs`,
				(i) => rawApi('DELETE', `/organizations/${TEST_ORG}/runs/${i.id}`),
				{ q: PREFIX, status, per_page: 100 },
			);
		}
		// Orphaned one-off / step tasks.
		await sweep(`/organizations/${TEST_ORG}/tasks`, (i) =>
			rawApi('DELETE', `/organizations/${TEST_ORG}/tasks/${i.id}`),
		);
		await sweep(`/organizations/${TEST_ORG}/checklists`, (i) =>
			rawApi('DELETE', `/organizations/${TEST_ORG}/checklists/${i.id}`),
		);
		await sweep(`/organizations/${TEST_ORG}/tags`, (i) =>
			rawApi('DELETE', `/organizations/${TEST_ORG}/tags/${i.id}`),
		);
		await sweep(`/organizations/${TEST_ORG}/groups`, (i) =>
			rawApi('DELETE', `/organizations/${TEST_ORG}/groups/${i.id}`),
		);
		await sweep(
			`/organizations/${TEST_ORG}/guests`,
			(i) => rawApi('DELETE', `/organizations/${TEST_ORG}/guests/${i.email}`),
			{ per_page: 100 },
		);
	});

	describe('Blueprint (template) CRUD', () => {
		it('creates, reads, updates and deletes a blueprint', async () => {
			const title = uniq('bp');

			// CREATE
			const created = await runLive({
				resource: 'blueprint',
				operation: 'create',
				title,
				type: 'procedure',
				additionalFields: {},
			});
			const bp = data(created.out[0].json) as IDataObject;
			expect(bp.id).toBeTruthy();
			expect(bp.title).toBe(title);
			// The node built exactly the org-scoped POST /checklists.
			expect(created.captured[0].options.method).toBe('POST');
			expect(String(created.captured[0].options.url)).toContain(
				`/organizations/${TEST_ORG}/checklists`,
			);
			const bpId = bp.id as string;

			// READ
			const got = await runLive({ resource: 'blueprint', operation: 'get', blueprintId: bpId });
			expect((data(got.out[0].json) as IDataObject).id).toBe(bpId);

			// UPDATE (title is required on blueprint update)
			const newTitle = `${title}-upd`;
			const updated = await runLive({
				resource: 'blueprint',
				operation: 'update',
				blueprintId: bpId,
				title: newTitle,
				additionalFields: { summary: 'updated by live test' },
			});
			expect(updated.captured[0].options.method).toBe('PUT');
			expect((data(updated.out[0].json) as IDataObject).title).toBe(newTitle);

			// DELETE
			const deleted = await runLive({
				resource: 'blueprint',
				operation: 'delete',
				blueprintId: bpId,
			});
			expect(deleted.captured[0].options.method).toBe('DELETE');
			// Confirm it is gone.
			await expect(
				rawApi('GET', `/organizations/${TEST_ORG}/checklists/${bpId}`),
			).rejects.toThrow();
		});

		it('lists blueprints (getAll, limited) and returns an array', async () => {
			const res = await runLive({
				resource: 'blueprint',
				operation: 'getAll',
				returnAll: false,
				filters: {},
				limit: 3,
			});
			expect(res.captured[0].options.method).toBe('GET');
			expect(res.captured[0].options.qs).toMatchObject({ limit: 3 });
			expect(Array.isArray(res.out)).toBe(true);
		});
	});

	describe('Process (run) lifecycle', () => {
		let bpId: string;

		beforeAll(async () => {
			const bp = await rawApi('POST', `/organizations/${TEST_ORG}/checklists`, {
				title: uniq('proc-bp'),
				type: 'procedure',
			});
			bpId = (data(bp) as IDataObject).id as string;
			await createStep(bpId, uniq('proc-step'));
		});

		afterAll(async () => {
			if (bpId) await rawApi('DELETE', `/organizations/${TEST_ORG}/checklists/${bpId}`).catch(() => undefined);
		});

		it('launches a process (checklist_id, not template_id), reads it, its tasks, then archives it', async () => {
			const name = uniq('run');
			const launched = await runLive({
				resource: 'process',
				operation: 'launch',
				blueprintId: bpId,
				processName: name,
				additionalFields: {},
			});
			expect(launched.captured[0].options.method).toBe('POST');
			expect(String(launched.captured[0].options.url)).toContain(`/organizations/${TEST_ORG}/runs`);
			expect(launched.captured[0].options.body).toMatchObject({ checklist_id: bpId, name });
			const run = data(launched.out[0].json) as IDataObject;
			expect(run.id).toBeTruthy();
			const runId = run.id as string;

			// READ
			const got = await runLive({ resource: 'process', operation: 'get', processId: runId });
			expect((data(got.out[0].json) as IDataObject).id).toBe(runId);

			// TASKS (blueprint had a step, so the run has at least one task)
			const tasks = await runLive({
				resource: 'process',
				operation: 'getTasks',
				processId: runId,
			});
			expect(Array.isArray(tasks.out)).toBe(true);
			expect(tasks.out.length).toBeGreaterThan(0);

			// ARCHIVE (DELETE /runs/{id})
			const archived = await runLive({
				resource: 'process',
				operation: 'archive',
				processId: runId,
			});
			expect(archived.captured[0].options.method).toBe('DELETE');
		});

		it('forwards status=issue on process getAll (issue #1: request path already supports it)', async () => {
			// The API folds `issue` runs into the `problem` filter; the only gap in #1 is the UI
			// preset. This proves the node forwards the value and the API accepts it (HTTP 200).
			const res = await runLive({
				resource: 'process',
				operation: 'getAll',
				returnAll: false,
				filters: { status: 'issue' },
				limit: 2,
			});
			expect(res.captured[0].options.qs).toMatchObject({ status: 'issue', limit: 2 });
			expect(Array.isArray(res.out)).toBe(true);
		});
	});

	describe('Process launch with kickoff (prerun) values (issue #6)', () => {
		let bpId: string;
		const fields: Record<string, IDataObject> = {};

		beforeAll(async () => {
			const created = await rawApi('POST', `/organizations/${TEST_ORG}/checklists`, {
				title: uniq('ko-bp'),
				type: 'procedure',
			});
			const bp = data(created) as IDataObject;
			bpId = bp.id as string;
			// Add one kickoff field per choice/scalar type. The PUT echoes each field's id/alias.
			const put = await rawApi('PUT', `/organizations/${TEST_ORG}/checklists/${bpId}`, {
				title: bp.title,
				prerun: [
					{ label: 'Cust Name', field_type: 'text', required: false, position: 1 },
					{
						label: 'Plan',
						field_type: 'dropdown',
						required: false,
						position: 2,
						options: [
							{ id: 1, text: 'Silver' },
							{ id: 2, text: 'Gold' },
						],
					},
					{
						label: 'Addons',
						field_type: 'multiselect',
						required: false,
						position: 3,
						options: [
							{ id: 1, text: 'SSO' },
							{ id: 2, text: 'Audit' },
							{ id: 3, text: 'SLA' },
						],
					},
					{
						label: 'Tier',
						field_type: 'radio',
						required: false,
						position: 4,
						options: [
							{ id: 1, text: 'Free' },
							{ id: 2, text: 'Paid' },
						],
					},
				],
			});
			for (const f of (data(put) as IDataObject).prerun as IDataObject[]) {
				fields[f.field_type as string] = f;
			}
		});

		afterAll(async () => {
			if (bpId) await rawApi('DELETE', `/organizations/${TEST_ORG}/checklists/${bpId}`).catch(() => undefined);
		});

		it('launches with kickoff values and the API STORES the correct per-type shapes', async () => {
			const launched = await runLive({
				resource: 'process',
				operation: 'launch',
				blueprintId: bpId,
				processName: uniq('ko-run'),
				kickoffValues: {
					values: [
						{ field: 'Cust Name', value: 'Acme Inc' }, // by label -> scalar
						{ field: fields.dropdown.alias, value: 'Gold' }, // by alias -> {id,text}
						{ field: fields.multiselect.id, value: 'SSO, SLA' }, // by id -> list
						{ field: 'Tier', value: 'Paid' }, // by label -> radio bare text
					],
				},
				additionalFields: {},
			});

			// 1) The node built the prerun object keyed by field id with per-type encoding.
			const sentPrerun = (
				launched.captured[launched.captured.length - 1].options.body as IDataObject
			).prerun as IDataObject;
			expect(sentPrerun[fields.dropdown.id as string]).toEqual({ id: 2, text: 'Gold' });
			expect(sentPrerun[fields.multiselect.id as string]).toEqual([
				{ id: 1, text: 'SSO', selected: true },
				{ id: 3, text: 'SLA', selected: true },
			]);
			expect(sentPrerun[fields.radio.id as string]).toBe('Paid');
			expect(sentPrerun[fields.text.id as string]).toBe('Acme Inc');

			const runId = (data(launched.out[0].json) as IDataObject).id as string;
			expect(runId).toBeTruthy();

			// 2) The API actually STORED them (read back; guards against the silent-201 trap where a
			//    wrong-keyed launch returns 201 with nothing stored).
			const stored = (
				data(
					await rawApi('GET', `/organizations/${TEST_ORG}/runs/${runId}`, undefined, {
						with: 'prerun',
					}),
				) as IDataObject
			).prerun as IDataObject;
			expect(stored[fields.dropdown.id as string]).toEqual({ id: 2, text: 'Gold' });
			expect(stored[fields.multiselect.id as string]).toEqual([
				{ id: 1, text: 'SSO', selected: true },
				{ id: 3, text: 'SLA', selected: true },
			]);
			expect(stored[fields.radio.id as string]).toBe('Paid');
			expect(stored[fields.text.id as string]).toBe('Acme Inc');

			await rawApi('DELETE', `/organizations/${TEST_ORG}/runs/${runId}`).catch(() => undefined);
		});

		it('fails loudly when an entry matches no kickoff field (not a silent 201)', async () => {
			await expect(
				runLive({
					resource: 'process',
					operation: 'launch',
					blueprintId: bpId,
					processName: uniq('ko-bad'),
					kickoffValues: { values: [{ field: 'no-such-field', value: 'x' }] },
					additionalFields: {},
				}),
			).rejects.toThrow(/not found on template/);
		});
	});

	describe('Task (one-off) CRUD + complete', () => {
		it('creates, reads, updates, completes and deletes a one-off task', async () => {
			const creds = loadCreds();
			const title = uniq('task');

			// CREATE (assign to self so complete is permitted)
			const created = await runLive({
				resource: 'task',
				operation: 'createOneOff',
				title,
				task_type: 'task',
				deadline: '2027-01-01 00:00:00',
				additionalFields: { assignUsers: String(creds.userId) },
			});
			expect(created.captured[0].options.method).toBe('POST');
			expect(String(created.captured[0].options.url)).toContain(`/organizations/${TEST_ORG}/tasks`);
			const task = data(created.out[0].json) as IDataObject;
			expect(task.id).toBeTruthy();
			const taskId = task.id as string;

			// READ
			const got = await runLive({ resource: 'task', operation: 'get', taskId });
			expect((data(got.out[0].json) as IDataObject).id).toBe(taskId);

			// UPDATE PROPERTIES (title + deadline + owners are required by the API)
			const newTitle = `${title}-upd`;
			const updated = await runLive({
				resource: 'task',
				operation: 'updateProperties',
				taskId,
				updateFields: {
					title: newTitle,
					deadline: '2027-02-01 00:00:00',
					assignUsers: String(creds.userId),
				},
			});
			expect(updated.captured[0].options.method).toBe('PUT');
			expect((data(updated.out[0].json) as IDataObject).title).toBe(newTitle);

			// COMPLETE (org-scoped /completed-tasks for a one-off task)
			const completed = await runLive({
				resource: 'task',
				operation: 'complete',
				taskId,
				additionalFields: {},
			});
			expect(completed.captured[0].options.method).toBe('POST');
			expect(String(completed.captured[0].options.url)).toContain(
				`/organizations/${TEST_ORG}/completed-tasks`,
			);

			// DELETE
			const deleted = await runLive({ resource: 'task', operation: 'delete', taskId });
			expect(deleted.captured[0].options.method).toBe('DELETE');
		});

		it('lists my tasks (getMyTasks)', async () => {
			const res = await runLive({
				resource: 'task',
				operation: 'getMyTasks',
				returnAll: false,
				filters: {},
				limit: 5,
			});
			expect(String(res.captured[0].options.url)).toContain(`/organizations/${TEST_ORG}/me/tasks`);
			expect(Array.isArray(res.out)).toBe(true);
		});
	});

	describe('Comment CRUD on a real process task', () => {
		let bpId: string;
		let runId: string;
		let taskId: string;

		beforeAll(async () => {
			const bp = await rawApi('POST', `/organizations/${TEST_ORG}/checklists`, {
				title: uniq('cmt-bp'),
				type: 'procedure',
			});
			bpId = (data(bp) as IDataObject).id as string;
			await createStep(bpId, uniq('cmt-step'));
			const run = await rawApi('POST', `/organizations/${TEST_ORG}/runs`, {
				checklist_id: bpId,
				name: uniq('cmt-run'),
			});
			runId = (data(run) as IDataObject).id as string;
			const tasks = await rawApi('GET', `/organizations/${TEST_ORG}/runs/${runId}/tasks`);
			taskId = (data<IDataObject[]>(tasks) as IDataObject[])[0].id as string;
		});

		afterAll(async () => {
			if (runId) await rawApi('DELETE', `/organizations/${TEST_ORG}/runs/${runId}`).catch(() => undefined);
			if (bpId) await rawApi('DELETE', `/organizations/${TEST_ORG}/checklists/${bpId}`).catch(() => undefined);
		});

		it('creates, updates, lists and deletes a comment', async () => {
			const content = `${PREFIX} comment ${Date.now()}`;

			// CREATE
			const created = await runLive({
				resource: 'comment',
				operation: 'create',
				taskId,
				content,
			});
			expect(created.captured[0].options.method).toBe('POST');
			expect(String(created.captured[0].options.url)).toContain(
				`/organizations/${TEST_ORG}/tasks/${taskId}/comment`,
			);
			const comment = data(created.out[0].json) as IDataObject;
			const commentId = comment.id as string;
			expect(commentId).toBeTruthy();

			// UPDATE
			const updated = await runLive({
				resource: 'comment',
				operation: 'update',
				taskId,
				commentId,
				content: `${content} (edited)`,
			});
			expect(updated.captured[0].options.method).toBe('PUT');

			// LIST (surfaces embedded threads on the run task)
			const listed = await runLive({
				resource: 'comment',
				operation: 'list',
				processId: runId,
				taskId,
			});
			expect(listed.captured[0].options.qs).toMatchObject({ with: 'threads' });
			expect(Array.isArray(listed.out)).toBe(true);

			// DELETE
			const deleted = await runLive({
				resource: 'comment',
				operation: 'delete',
				taskId,
				commentId,
			});
			expect(deleted.captured[0].options.method).toBe('DELETE');
		});
	});

	describe('Form Field (template capture) CRUD', () => {
		let bpId: string;
		let stepId: string;

		beforeAll(async () => {
			const bp = await rawApi('POST', `/organizations/${TEST_ORG}/checklists`, {
				title: uniq('ff-bp'),
				type: 'procedure',
			});
			bpId = (data(bp) as IDataObject).id as string;
			stepId = await createStep(bpId, uniq('ff-step'));
		});

		afterAll(async () => {
			if (bpId) await rawApi('DELETE', `/organizations/${TEST_ORG}/checklists/${bpId}`).catch(() => undefined);
		});

		it('adds a field, reads step fields, updates the field, then deletes it', async () => {
			const label = uniq('field');

			// ADD (capture on the step)
			const added = await runLive({
				resource: 'formField',
				operation: 'addField',
				blueprintId: bpId,
				stepId,
				fieldData: { label, field_type: 'text', required: false },
			});
			expect(added.captured[0].options.method).toBe('POST');
			expect(String(added.captured[0].options.url)).toContain(
				`/checklists/${bpId}/steps/${stepId}/captures`,
			);
			const field = data(added.out[0].json) as IDataObject;
			const captureFieldId = field.id as string;
			expect(captureFieldId).toBeTruthy();
			expect(field.label).toBe(label);

			// READ (template form fields)
			const fields = await runLive({
				resource: 'formField',
				operation: 'getFields',
				contextType: 'template',
				blueprintId: bpId,
			});
			expect(Array.isArray(fields.out)).toBe(true);

			// UPDATE (field_type immutable; change the label). The capture PUT re-validates the
			// whole field definition, so `required` must be present - the node passes fieldData
			// through verbatim, so the caller supplies the full field object.
			const newLabel = `${label}-upd`;
			const updated = await runLive({
				resource: 'formField',
				operation: 'updateField',
				blueprintId: bpId,
				stepId,
				captureFieldId,
				fieldData: { label: newLabel, field_type: 'text', required: false },
			});
			expect(updated.captured[0].options.method).toBe('PUT');

			// DELETE
			const deleted = await runLive({
				resource: 'formField',
				operation: 'deleteField',
				blueprintId: bpId,
				stepId,
				captureFieldId,
			});
			expect(deleted.captured[0].options.method).toBe('DELETE');
		});
	});

	// Issue #9: run-level formField:updateValue. The node builds the correct request (asserted per
	// field type in the mocked suite), but api-v2 rejects it server-side. This exercises the run-level
	// path end to end against staging and pins the CURRENT api-v2 behavior as a tripwire.
	describe('Form Field: run-level updateValue precondition (issue #9)', () => {
		let bpId: string;
		let runId: string;
		let runFieldId: string;

		beforeAll(async () => {
			const bp = await rawApi('POST', `/organizations/${TEST_ORG}/checklists`, {
				title: uniq('rfv-bp'),
				type: 'procedure',
			});
			bpId = (data(bp) as IDataObject).id as string;
			const stepId = await createStep(bpId, uniq('rfv-step'));
			await rawApi('POST', `/organizations/${TEST_ORG}/checklists/${bpId}/steps/${stepId}/captures`, {
				label: 'Notes',
				field_type: 'text',
				required: false,
			});
			const run = await rawApi('POST', `/organizations/${TEST_ORG}/runs`, {
				checklist_id: bpId,
				name: uniq('rfv-run'),
			});
			runId = (data(run) as IDataObject).id as string;
			// Assign the sole task to self so the failure is the field-value precondition, not authz
			// (issue #9 reproduces "even after the task is assigned").
			const creds = loadCreds();
			const tasks = data<IDataObject[]>(
				await rawApi('GET', `/organizations/${TEST_ORG}/runs/${runId}/tasks`),
			) as IDataObject[];
			if (tasks[0]) {
				await rawApi('PUT', `/organizations/${TEST_ORG}/runs/${runId}/tasks/${tasks[0].id}`, {
					owners: { users: [Number(creds.userId)], guests: [], groups: [] },
				}).catch(() => undefined);
			}
			// The run's form-fields expose each capture (field-definition id); this is the only id a
			// workflow can obtain for a never-filled run-level field.
			const rff = data(
				await rawApi('GET', `/organizations/${TEST_ORG}/runs/${runId}/form-fields`),
			) as IDataObject;
			runFieldId = ((rff.form_fields as IDataObject[]) || [])[0].id as string;
		});

		afterAll(async () => {
			if (runId) await rawApi('DELETE', `/organizations/${TEST_ORG}/runs/${runId}`).catch(() => undefined);
			if (bpId) await rawApi('DELETE', `/organizations/${TEST_ORG}/checklists/${bpId}`).catch(() => undefined);
		});

		// TRIPWIRE: api-v2 UpdateFormFieldValueRequest::postValidate() runs
		// `CaptureValue::find($id)->capture` with no null-guard, and FormFieldService::updateValue()
		// has no create-if-missing, so a run-level field with no stored CaptureValue yet returns
		// HTTP 500 "Attempt to read property `capture` on null". This asserts that CURRENT behavior.
		//
		// The server-side gap is tallyfy/api-v2 issue #5010, PR #8955. Both were still open on
		// 2026-08-09. There is no node work outstanding here: the request shape is correct and is
		// asserted per field type in the mocked suite.
		//
		// THIS TEST GOING RED IS THE SIGNAL, NOT A REGRESSION. It goes red on two different events
		// and they need different responses, so read which one happened before touching it:
		//
		//   1. api-v2 PR #8955 lands. It converts the 500 into a 422 with proper validation, and
		//      the message stops containing "capture", so the assertion below stops matching. The
		//      operation STILL DOES NOT WORK. Re-point the assertion at the new 422 and keep the
		//      test red-on-success. Do NOT relax it to "rejects with anything", which would make
		//      the tripwire unable to notice event 2.
		//   2. A real create-or-update fix lands, mirroring the guest storeOrUpdateFields path.
		//      Then this call SUCCEEDS. Flip the test to a stored-value round-trip: read back
		//      GET /runs/{runId}/form-fields and assert the value persisted.
		//
		// In neither case is the right move to delete or skip this test.
		it('run-level updateValue is rejected by the current api-v2 precondition (api-v2 #5010 tripwire)', async () => {
			expect(runFieldId).toBeTruthy();
			await expect(
				runLive({
					resource: 'formField',
					operation: 'updateValue',
					asGuest: false,
					formFieldId: runFieldId,
					fieldType: 'text',
					fieldValue: `${PREFIX}-rfv-value`,
				}),
			).rejects.toThrow(/capture/i);
		});
	});

	describe('Group CRUD', () => {
		it('creates, reads, updates and deletes a group', async () => {
			const name = uniq('grp');
			const created = await runLive({
				resource: 'group',
				operation: 'create',
				name,
				description: 'live test group',
			});
			expect(created.captured[0].options.method).toBe('POST');
			const group = data(created.out[0].json) as IDataObject;
			const groupId = group.id as string;
			expect(groupId).toBeTruthy();
			expect(group.name).toBe(name);

			const got = await runLive({ resource: 'group', operation: 'get', groupId });
			expect((data(got.out[0].json) as IDataObject).id).toBe(groupId);

			const updated = await runLive({
				resource: 'group',
				operation: 'update',
				groupId,
				description: 'updated description',
			});
			expect(updated.captured[0].options.method).toBe('PUT');

			const deleted = await runLive({ resource: 'group', operation: 'delete', groupId });
			expect(deleted.captured[0].options.method).toBe('DELETE');
		});
	});

	describe('Guest CRUD', () => {
		it('creates, reads, updates and deletes a guest (by email)', async () => {
			// Staging rejects example.com; a gmail.com address validates. Emails are logged, not sent.
			const email = `${PREFIX}.${Date.now()}@gmail.com`.replace(/-/g, '.');
			const created = await runLive({
				resource: 'guest',
				operation: 'create',
				email,
				firstName: 'Live',
				lastName: 'Test',
			});
			expect(created.captured[0].options.method).toBe('POST');
			expect(String(created.captured[0].options.url)).toContain(`/organizations/${TEST_ORG}/guests`);

			const got = await runLive({ resource: 'guest', operation: 'get', email });
			expect(got.out[0].json).toBeTruthy();

			const updated = await runLive({
				resource: 'guest',
				operation: 'update',
				email,
				firstName: 'Live2',
				lastName: 'Test2',
			});
			expect(updated.captured[0].options.method).toBe('PUT');

			const deleted = await runLive({ resource: 'guest', operation: 'delete', email });
			expect(deleted.captured[0].options.method).toBe('DELETE');
		});
	});

	describe('Tag CRUD + association', () => {
		it('creates, updates, associates to a process, then deletes a tag', async () => {
			// Tag titles are capped at 30 chars, so keep it short while still PREFIX-matched
			// (so the sweeper catches any leftover).
			const tagTitle = `${PREFIX}-${Math.random().toString(36).slice(2, 8)}`;
			const created = await runLive({
				resource: 'tag',
				operation: 'create',
				tagTitle,
				tagColor: '#00803d',
			});
			expect(created.captured[0].options.method).toBe('POST');
			const tag = data(created.out[0].json) as IDataObject;
			const tagId = tag.id as string;
			expect(tagId).toBeTruthy();

			const updated = await runLive({
				resource: 'tag',
				operation: 'update',
				tagId,
				tagTitle: `${tagTitle}u`,
				tagColor: '#ff0000',
			});
			expect(updated.captured[0].options.method).toBe('PUT');

			// Associate to a throwaway process, then remove the association.
			const bp = await rawApi('POST', `/organizations/${TEST_ORG}/checklists`, {
				title: uniq('tag-bp'),
				type: 'procedure',
			});
			const bpId = (data(bp) as IDataObject).id as string;
			const run = await rawApi('POST', `/organizations/${TEST_ORG}/runs`, {
				checklist_id: bpId,
				name: uniq('tag-run'),
			});
			const runId = (data(run) as IDataObject).id as string;
			try {
				const tagged = await runLive({
					resource: 'tag',
					operation: 'tagProcess',
					subjectId: runId,
					tagId,
				});
				expect(tagged.captured[0].options.body).toMatchObject({
					subject_id: runId,
					subject_type: 'Run',
					tag_id: tagId,
				});
			} finally {
				await rawApi('DELETE', `/organizations/${TEST_ORG}/runs/${runId}`).catch(() => undefined);
				await rawApi('DELETE', `/organizations/${TEST_ORG}/checklists/${bpId}`).catch(() => undefined);
			}

			const deleted = await runLive({ resource: 'tag', operation: 'delete', tagId });
			expect(deleted.captured[0].options.method).toBe('DELETE');
		});

		it('lists tags (getAll)', async () => {
			const res = await runLive({
				resource: 'tag',
				operation: 'getAll',
				returnAll: false,
				filters: {},
				limit: 5,
			});
			expect(String(res.captured[0].options.url)).toContain(`/organizations/${TEST_ORG}/tags`);
			expect(Array.isArray(res.out)).toBe(true);
		});
	});

	describe('User (read-only) + Organization', () => {
		it('gets the current user (/me)', async () => {
			const res = await runLive({ resource: 'user', operation: 'getCurrent' });
			expect(String(res.captured[0].options.url)).toContain('/me');
			expect((data(res.out[0].json) as IDataObject).id).toBeTruthy();
		});

		it('lists org users (getAll)', async () => {
			const res = await runLive({
				resource: 'user',
				operation: 'getAll',
				returnAll: false,
				filters: {},
				limit: 5,
			});
			expect(String(res.captured[0].options.url)).toContain(`/organizations/${TEST_ORG}/users`);
			expect(Array.isArray(res.out)).toBe(true);
		});

		it('gets the organization', async () => {
			const res = await runLive({ resource: 'user', operation: 'getOrganization' });
			expect(String(res.captured[0].options.url)).toContain(`/organizations/${TEST_ORG}`);
			expect((data(res.out[0].json) as IDataObject).id).toBeTruthy();
		});
	});

	describe('Search + ID Finder', () => {
		it('runs a global search across task and process scopes', async () => {
			const res = await runLive({
				resource: 'search',
				operation: 'global',
				searchQuery: 'test',
				searchIn: ['task', 'process'],
			});
			expect(res.captured[0].options.qs).toMatchObject({
				search: 'test',
				on: 'task,process',
				per_page: 50,
			});
			expect(res.out.length).toBeGreaterThan(0);
		});

		it('finds a blueprint by search term and simplifies the result to {id,name,type}', async () => {
			// Seed one so the finder has a deterministic hit.
			const title = uniq('find-bp');
			const bp = await rawApi('POST', `/organizations/${TEST_ORG}/checklists`, {
				title,
				type: 'procedure',
			});
			const bpId = (data(bp) as IDataObject).id as string;
			try {
				const res = await runLive({
					resource: 'idFinder',
					operation: 'findBlueprintId',
					searchTerm: title,
				});
				expect(res.captured[0].options.qs).toMatchObject({ q: title, per_page: 10 });
				const hit = res.out.map((o) => o.json as IDataObject).find((r) => r.id === bpId);
				expect(hit).toBeTruthy();
				expect(hit!.type).toBe('Blueprint');
				expect(hit!.name).toBe(title);
			} finally {
				await rawApi('DELETE', `/organizations/${TEST_ORG}/checklists/${bpId}`).catch(() => undefined);
			}
		});
	});
});
