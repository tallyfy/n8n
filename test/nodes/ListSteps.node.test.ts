import type { IDataObject, IHttpRequestOptions, INodeExecutionData } from 'n8n-workflow';
import { Tallyfy } from '../../nodes/Tallyfy/Tallyfy.node';
import { createContextMock } from '../helpers/mocks';

/**
 * Template > List Steps returns every step (tallyfy/work-queue#4260).
 *
 * It made one request with no per_page. api-v2 pages the steps route at 10 by default, so
 * a template with more than 10 steps returned only its first 10. Measured on staging on
 * 2026-10-24 with a 12 step template: 10 came back.
 *
 * The node runs for real; only httpRequestWithAuthentication is replaced, by a copy of the
 * steps route's paging contract as measured on staging: 10 a page when per_page is absent,
 * at most 100, `limit` ignored, an empty page past the last, and meta.pagination with
 * total, count, per_page, current_page and total_pages. links.next is sent on an
 * unreachable host, as the real one names an internal host.
 */

const ORG = 'ORG123';
const STEPS_PATH = /\/organizations\/ORG123\/checklists\/(T\d+)\/steps$/;

function fakeStepsApi(totals: Record<string, number>) {
	const calls: IDataObject[] = [];
	const impl = async (_cred: string, options: IHttpRequestOptions): Promise<unknown> => {
		const qs = { ...((options.qs as IDataObject) ?? {}) };
		calls.push(qs);
		const m = String(options.url).match(STEPS_PATH);
		if (!m || !(m[1] in totals)) throw new Error(`unexpected request ${options.url}`);
		const total = totals[m[1]];
		const perPage = qs.per_page === undefined ? 10 : Math.min(Math.abs(parseInt(String(qs.per_page), 10)) || 20, 100);
		const page = qs.page === undefined ? 1 : Math.max(Math.min(Math.abs(parseInt(String(qs.page), 10)) || 0, 10000), 1);
		const totalPages = Math.max(Math.ceil(total / perPage), 1);
		const rows: IDataObject[] = [];
		for (let i = (page - 1) * perPage + 1; i <= Math.min(page * perPage, total); i++) {
			rows.push({ id: `step-${String(i).padStart(3, '0')}`, title: `Step ${i}`, position: i });
		}
		const links: IDataObject = {};
		if (page < totalPages) links.next = `https://internal-api.invalid/organizations/${ORG}/checklists/${m[1]}/steps?page=${page + 1}`;
		return {
			data: rows,
			meta: { pagination: { total, count: rows.length, per_page: perPage, current_page: page, total_pages: totalPages, links } },
		};
	};
	return { impl, calls };
}

async function listSteps(blueprintId: string, totals: Record<string, number>) {
	const api = fakeStepsApi(totals);
	const { ctx } = createContextMock({
		params: { resource: 'blueprint', operation: 'listSteps', blueprintId },
		httpImpl: api.impl,
	});
	const result = (await new Tallyfy().execute.call(ctx)) as INodeExecutionData[][];
	return { items: result[0], calls: api.calls };
}

describe('Template > List Steps reads every page (#4260)', () => {
	it('control: the fake, asked with no per_page, answers 10 of 11 as the API does', async () => {
		const api = fakeStepsApi({ T11: 11 });
		const body = (await api.impl('tallyfyApi', {
			url: `https://go.tallyfy.com/api/organizations/${ORG}/checklists/T11/steps`,
		})) as IDataObject;
		expect((body.data as IDataObject[]).length).toBe(10);
	});

	it('returns all 11 steps of an 11 step template, in order, as one item', async () => {
		const { items } = await listSteps('T11', { T11: 11 });
		expect(items).toHaveLength(1);
		const data = items[0].json.data as IDataObject[];
		expect(data.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
	});

	it('follows pagination past 100: 205 steps in 3 requests of 100, in order', async () => {
		const { items, calls } = await listSteps('T205', { T205: 205 });
		const data = items[0].json.data as IDataObject[];
		expect(data.map((s) => s.position)).toEqual(Array.from({ length: 205 }, (_, i) => i + 1));
		expect(calls.map((q) => q.page)).toEqual([1, 2, 3]);
		expect(calls.every((q) => q.per_page === 100)).toBe(true);
	});

	it('keeps meta, taken from the last page, so its total matches the steps returned', async () => {
		const { items } = await listSteps('T205', { T205: 205 });
		const pagination = (items[0].json.meta as IDataObject).pagination as IDataObject;
		expect(pagination.total).toBe(205);
		expect(pagination.current_page).toBe(pagination.total_pages);
	});

	it('makes one request for a template with no steps', async () => {
		const { items, calls } = await listSteps('T0', { T0: 0 });
		expect(items[0].json.data).toEqual([]);
		expect(calls).toHaveLength(1);
	});
});
