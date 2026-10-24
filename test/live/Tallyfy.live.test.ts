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
		// Scheduled jobs (#53). GET recurring-jobs reads no search term, so list this user's own.
		await sweep(
			`/organizations/${TEST_ORG}/recurring-jobs`,
			(i) => rawApi('DELETE', `/organizations/${TEST_ORG}/recurring-jobs/${i.id}`),
			{ created_by: 'me', per_page: 100 },
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

		// #55: the API reads per_page, not limit, and never sends has_more_pages, so Return All
		// used to stop at the default page of 10. It must now return every blueprint the API counts.
		it('returns every blueprint for Return All, and a Limit above 10 is honoured', async () => {
			const counted = await rawApi('GET', `/organizations/${TEST_ORG}/checklists`, undefined, { per_page: 1 });
			const total = Number(((counted.meta as IDataObject).pagination as IDataObject).total);
			// Over 10, or the old one-page loop would pass this too (22 on 2026-10-23).
			expect(total).toBeGreaterThan(10);

			const all = await runLive({ resource: 'blueprint', operation: 'getAll', returnAll: true, filters: {} });
			expect(all.out.length).toBe(total);
			expect(all.captured[0].options.qs).toMatchObject({ per_page: 100, page: 1 });

			const limited = await runLive({
				resource: 'blueprint',
				operation: 'getAll',
				returnAll: false,
				filters: {},
				limit: 12,
			});
			const rows = ((limited.out[0].json as IDataObject).data as IDataObject[]) || [];
			expect(rows.length).toBe(Math.min(12, total));
		});

		// tallyfy/work-queue#4260: List Steps made one request with no per_page, so the API's
		// default page of 10 cut a longer template short. It must return all 12 of 12, in order.
		it('List Steps returns every step of a 12 step template, in order', async () => {
			const created = await rawApi('POST', `/organizations/${TEST_ORG}/checklists`, {
				title: uniq('steps'),
				type: 'procedure',
			});
			const bpId = (data(created) as IDataObject).id as string;
			try {
				for (let i = 1; i <= 12; i++) {
					await rawApi('POST', `/organizations/${TEST_ORG}/checklists/${bpId}/steps`, {
						checklist_id: bpId,
						title: `step ${i}`,
						step_type: 'task',
						position: i,
					});
				}
				// Control: one request with no per_page still stops at 10, so this test can fail.
				const onePage = await rawApi('GET', `/organizations/${TEST_ORG}/checklists/${bpId}/steps`);
				expect((data<IDataObject[]>(onePage) as IDataObject[]).length).toBe(10);

				const res = await runLive({ resource: 'blueprint', operation: 'listSteps', blueprintId: bpId });
				expect(res.out).toHaveLength(1);
				const steps = (res.out[0].json as IDataObject).data as IDataObject[];
				expect(steps.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
				expect(res.captured[0].options.qs).toMatchObject({ per_page: 100, page: 1 });
			} finally {
				await rawApi('DELETE', `/organizations/${TEST_ORG}/checklists/${bpId}`).catch(() => undefined);
			}
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

		// TRIPWIRE, re-pointed 2026-10-23 (#59). api-v2 looks the value up by its stored
		// CaptureValue id and has no create-if-missing, so a run-level field that has never been
		// filled cannot be set through PUT /form-field/value.
		//
		// Until 2026-09-17 that was HTTP 500 "Attempt to read property `capture` on null", and this
		// test asserted the word "capture". That was event 1 of the two it was written to notice:
		// the 500 became a 422 and the message changed. Production answers "No form field value
		// matches this id." (api-v2 commit 77f046a70). Staging runs api-v2 master, which carries
		// api-v2 PR #8955 and answers "The form field could not be found." Measured on staging on
		// 2026-10-23: 422 with that message for an id matching no stored value, and 401 for a
		// made-up token on the same call. The operation STILL DOES NOT WORK; the server-side gap is
		// tallyfy/api-v2 issue #5010. There is no node work outstanding: the request shape is
		// correct and is asserted per field type in the mocked suite.
		//
		// THIS TEST GOING RED IS THE SIGNAL, NOT A REGRESSION. Read which of these happened first:
		//
		//   - The call SUCCEEDS. A real create-or-update fix landed, mirroring the guest
		//     storeOrUpdateFields path. Flip the test to a stored-value round-trip: read back
		//     GET /runs/{runId}/form-fields and assert the value persisted. That closes #9.
		//   - A 500 comes back. The old crash returned, which is an api-v2 regression to report.
		//   - A 422 with other words. api-v2 reworded it. Re-point the message, keep the 422, and
		//     keep the test red on success.
		//
		// In no case is the right move to delete or skip this test, or to relax it to "rejects
		// with anything", which could never notice a success.
		it('run-level updateValue is refused with a 422 naming the id (api-v2 #5010 tripwire)', async () => {
			expect(runFieldId).toBeTruthy();
			const refusal = await runLive({
				resource: 'formField',
				operation: 'updateValue',
				asGuest: false,
				formFieldId: runFieldId,
				fieldType: 'text',
				fieldValue: `${PREFIX}-rfv-value`,
			}).then(
				() => null,
				(error: unknown) => error as Error,
			);
			// Red on success: the first case above.
			expect(refusal).not.toBeNull();
			// The node wraps the transport error and keeps it as `cause`, which carries the status.
			const status = (refusal!.cause as { statusCode?: number } | undefined)?.statusCode;
			// Red on the old 500, or on any status but 422.
			expect(status).toBe(422);
			expect(refusal!.message).toMatch(
				/The form field could not be found\.|No form field value matches this id\./,
			);
			expect(refusal!.message).not.toMatch(/capture/i);
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

	// tallyfy/n8n#53. Every job here starts at least two days out, so none can fire while the test
	// runs, and each is deleted at the end of its test (the sweeper above is the backstop).
	describe('Scheduled Job lifecycle (#53)', () => {
		/** A day N days from now, as YYYY-MM-DD in UTC. */
		const dayFromNow = (days: number): string =>
			new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

		const jobUrl = (id: unknown) => `/organizations/${TEST_ORG}/recurring-jobs/${String(id)}`;

		it('creates a Once task job, reads, finds, pauses, resumes, renames, reads history and deletes it', async () => {
			const name = uniq('sj-once');
			const created = await runLive({
				resource: 'scheduledJob',
				operation: 'create',
				jobName: name,
				jobType: 'createTask',
				frequency: 'once',
				startDate: `${dayFromNow(2)}T00:00:00`,
				startTime: '12:00',
				taskTitle: uniq('sj-task'),
				taskType: 'task',
				taskDeadline: `${dayFromNow(4)} 17:00:00`,
				taskOptions: {},
				scheduledJobFields: { description: 'n8n live test' },
			});
			// The type id was looked up, then the job was created.
			expect(String(created.captured[0].options.url)).toContain('/recurring-job-types');
			expect(created.captured[1].options.method).toBe('POST');
			const job = created.out[0].json as IDataObject;
			const jobId = job.id;
			try {
				expect(jobId).toBeTruthy();
				expect(job.name).toBe(name);
				expect(job.status).toBe('active');
				expect(job.max_occurrences).toBe(1);
				// The server stamps who created it (api-v2#10871).
				expect((job.data as IDataObject).created_by).toBeTruthy();

				// GET
				const got = await runLive({ resource: 'scheduledJob', operation: 'get', scheduledJobId: String(jobId) });
				expect((got.out[0].json as IDataObject).id).toBe(jobId);

				// GET MANY with created_by=me finds it, and the request carried the filter.
				const mine = await runLive({
					resource: 'scheduledJob',
					operation: 'getAll',
					returnAll: true,
					createdByMe: true,
				});
				expect(mine.captured[0].options.qs).toMatchObject({ created_by: 'me', per_page: 100, page: 1 });
				expect(mine.out.map((o) => (o.json as IDataObject).id)).toContain(jobId);

				// PAUSE, then RESUME: each reads the job and sends it all back with the new status.
				const paused = await runLive({ resource: 'scheduledJob', operation: 'pause', scheduledJobId: String(jobId) });
				expect(paused.captured.map((c) => c.options.method)).toEqual(['GET', 'PUT']);
				expect((paused.out[0].json as IDataObject).status).toBe('paused');
				const resumed = await runLive({ resource: 'scheduledJob', operation: 'resume', scheduledJobId: String(jobId) });
				expect((resumed.out[0].json as IDataObject).status).toBe('active');

				// UPDATE the name only; everything else goes back as it was.
				const renamed = `${name}-upd`;
				const updated = await runLive({
					resource: 'scheduledJob',
					operation: 'update',
					scheduledJobId: String(jobId),
					scheduledJobUpdateFields: { name: renamed },
				});
				const after = updated.out[0].json as IDataObject;
				expect(after.name).toBe(renamed);
				expect(after.max_occurrences).toBe(1);
				expect((after.data as IDataObject).title).toBe((job.data as IDataObject).title);

				// HISTORY: it has never run, so there is nothing to output.
				const history = await runLive({ resource: 'scheduledJob', operation: 'getHistory', scheduledJobId: String(jobId) });
				expect(String(history.captured[0].options.url)).toContain(`/recurring-jobs/${String(jobId)}/history`);
				expect(history.out).toEqual([]);
			} finally {
				// DELETE through the node, then confirm the job is gone. Guarded so a failed create
				// reports its own error rather than this one's.
				if (jobId) {
					const deleted = await runLive({ resource: 'scheduledJob', operation: 'delete', scheduledJobId: String(jobId) });
					expect(deleted.captured[0].options.method).toBe('DELETE');
				}
			}
			await expect(rawApi('GET', jobUrl(jobId))).rejects.toThrow(/404/);

			// The deleted job's 404 comes back through the node as the missing-or-hidden message.
			await expect(
				runLive({ resource: 'scheduledJob', operation: 'get', scheduledJobId: String(jobId) }),
			).rejects.toThrow(/was not found\. Either it does not exist in this organization, or the connected user may not manage it/);
		});

		it('creates a Recurring weekly task job with deadline_offset, which the API stores, then deletes it', async () => {
			const created = await runLive({
				resource: 'scheduledJob',
				operation: 'create',
				jobName: uniq('sj-weekly'),
				jobType: 'createTask',
				frequency: 'recurring',
				recurringType: 'weekly',
				interval: 1,
				daysOfWeek: [1, 3],
				startDate: dayFromNow(2),
				startTime: '08:00',
				taskTitle: uniq('sj-task'),
				taskType: 'task',
				deadlineOffsetValue: 2,
				deadlineOffsetUnit: 'days',
				taskOptions: {},
				scheduledJobFields: { startPaused: true },
			});
			const job = created.out[0].json as IDataObject;
			try {
				expect(job.status).toBe('paused');
				const stored = (await rawApi('GET', jobUrl(job.id))).data as IDataObject;
				expect((stored.data as IDataObject).deadline_offset).toEqual({ value: 2, unit: 'days' });
				expect((stored.data as IDataObject).deadline ?? null).toBeNull();
				const schedule = stored.schedule as IDataObject;
				expect(schedule.recurring_type).toBe('weekly');
				// Monday and Wednesday where the API keeps a list (api-v2#8974), else Monday alone.
				if (Array.isArray(schedule.days_of_week)) {
					expect(schedule.days_of_week).toEqual([1, 3]);
				} else {
					expect(schedule.day_of_week).toBe(1);
				}
			} finally {
				if (job?.id) await rawApi('DELETE', jobUrl(job.id)).catch(() => undefined);
			}
		});

		it('creates a Launch Process job for a blueprint, then deletes it', async () => {
			const bp = await rawApi('POST', `/organizations/${TEST_ORG}/checklists`, {
				title: uniq('sj-bp'),
				type: 'procedure',
			});
			const bpId = (data(bp) as IDataObject).id as string;
			let jobId: unknown;
			try {
				const created = await runLive({
					resource: 'scheduledJob',
					operation: 'create',
					jobName: uniq('sj-launch'),
					jobType: 'launchProcess',
					frequency: 'once',
					startDate: dayFromNow(3),
					startTime: '10:15',
					blueprintId: bpId,
					processName: uniq('sj-run'),
					kickoffValues: {},
					processOptions: {},
					scheduledJobFields: {},
				});
				const job = created.out[0].json as IDataObject;
				jobId = job.id;
				expect((job.data as IDataObject).checklist_id).toBe(bpId);
				expect((job.schedule as IDataObject).recurring_type).toBe('daily');
			} finally {
				if (jobId) await rawApi('DELETE', jobUrl(jobId)).catch(() => undefined);
				await rawApi('DELETE', `/organizations/${TEST_ORG}/checklists/${bpId}`).catch(() => undefined);
			}
		});
	});
});
