/**
 * Search API trace tests — WP-2
 *
 * Verifies that the search API wire includes `trace` in enriched responses
 * and omits it from non-enriched responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hand-rolled search query parser (avoids zod v4 resolution issue in vitest)
// ---------------------------------------------------------------------------
function parseSearchQuery(params: Record<string, string>) {
	const categories = params.categories;
	const indexers = params.indexers;
	const enrich = params.enrich;

	return {
		q: params.q || undefined,
		searchType: (params.searchType || 'basic') as 'basic' | 'movie' | 'tv' | 'music' | 'book',
		searchMode: params.searchMode as 'all' | 'multiSeasonPack' | undefined,
		categories: categories ? categories.split(',').map(Number) : undefined,
		indexers: indexers ? indexers.split(',') : undefined,
		minSeeders: params.minSeeders ? Number(params.minSeeders) : undefined,
		limit: params.limit ? Number(params.limit) : undefined,
		imdbId: params.imdbId || undefined,
		tmdbId: params.tmdbId ? Number(params.tmdbId) : undefined,
		tvdbId: params.tvdbId ? Number(params.tvdbId) : undefined,
		year: params.year ? Number(params.year) : undefined,
		season: params.season != null ? Number(params.season) : undefined,
		episode: params.episode != null ? Number(params.episode) : undefined,
		language: params.language || undefined,
		enrich: enrich === 'true' || enrich === '1',
		scoringProfileId: params.scoringProfileId || undefined,
		matchToTmdb: params.matchToTmdb === 'true' || params.matchToTmdb === '1',
		filterRejected:
			params.filterRejected === 'true' || params.filterRejected === '1',
		minScore: params.minScore ? Number(params.minScore) : undefined
	};
}

// ---------------------------------------------------------------------------
// Hoisted mocks — vitest pushes these before all imports
// ---------------------------------------------------------------------------
const mockSearchEnhanced = vi.hoisted(() => vi.fn());

const mockGetIndexerManager = vi.hoisted(() =>
	vi.fn().mockResolvedValue({
		getIndexers: vi.fn().mockResolvedValue([
			{
				id: 'idx-1',
				name: 'TestIndexer',
				enabled: true,
				enableInteractiveSearch: true,
				definitionId: 'test',
				protocol: 'torrent',
				enableAutomaticSearch: true
			}
		]),
		getDefinitionCapabilities: vi.fn().mockReturnValue({
			search: { available: true, supportedParams: ['q'] },
			movieSearch: { available: true, supportedParams: ['q', 'year'] },
			tvSearch: { available: true, supportedParams: ['q', 'season', 'episode'] },
			categories: [2000]
		}),
		searchEnhanced: mockSearchEnhanced
	})
);

const mockLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	child: vi.fn().mockReturnThis()
};

vi.mock('$lib/logging', () => ({
	logger: mockLogger,
	createChildLogger: vi.fn(() => mockLogger),
	createRequestLogger: vi.fn(() => mockLogger),
	runWithLogContext: vi.fn((_ctx: unknown, cb: () => unknown) => cb()),
	getRequestLogger: vi.fn(() => mockLogger),
	getRequestId: vi.fn(() => undefined),
	getSupportId: vi.fn(() => undefined)
}));

vi.mock('$lib/server/db', () => ({
	db: {
		query: {
			settings: { findFirst: vi.fn().mockResolvedValue(null) },
			movies: { findFirst: vi.fn().mockResolvedValue(null) },
			series: { findFirst: vi.fn().mockResolvedValue(null) }
		}
	}
}));

vi.mock('$lib/server/quality', () => ({
	qualityFilter: {
		getDefaultScoringProfile: vi.fn().mockResolvedValue({
			id: 'default',
			name: 'Default',
			isDefault: true,
			formatScores: {},
			allowedProtocols: ['torrent']
		}),
		getProfile: vi.fn().mockResolvedValue({
			id: 'default',
			name: 'Default',
			isDefault: true,
			formatScores: {},
			allowedProtocols: ['torrent']
		})
	}
}));

vi.mock('$lib/server/indexers/IndexerManager', () => ({
	getIndexerManager: mockGetIndexerManager
}));

vi.mock('$lib/validation/schemas', () => ({
	searchQuerySchema: {
		safeParse: (params: Record<string, string>) => ({
			success: true as const,
			data: parseSearchQuery(params)
		})
	}
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let GET: any;

describe('Search API trace', () => {
	beforeEach(async () => {
		vi.clearAllMocks();

		// Re-establish the default mock manager for every test.
		// Each test can override specific methods on this object.
		mockGetIndexerManager.mockResolvedValue({
			getIndexers: vi.fn().mockResolvedValue([
				{
					id: 'idx-1',
					name: 'TestIndexer',
					enabled: true,
					enableInteractiveSearch: true,
					definitionId: 'test',
					protocol: 'torrent',
					enableAutomaticSearch: true
				}
			]),
			getDefinitionCapabilities: vi.fn().mockReturnValue({
				search: { available: true, supportedParams: ['q'] },
				movieSearch: { available: true, supportedParams: ['q', 'year'] },
				tvSearch: { available: true, supportedParams: ['q', 'season', 'episode'] },
			categories: [2000]
		}),
		searchEnhanced: mockSearchEnhanced
	});

	const mod = await import('./+server');
	GET = mod.GET;
	});

	it('includes trace in enriched response', async () => {
		mockSearchEnhanced.mockResolvedValue({
			releases: [],
			totalResults: 0,
			rejectedCount: 0,
			searchTimeMs: 10,
			enrichTimeMs: 5,
			indexerResults: [],
			rejectedIndexers: [],
			trace: {
				stageOrder: ['filterIndexers'],
				stages: {
					filterIndexers: {
						index: 0,
						inputCount: 0,
						outputCount: 0,
						droppedCount: 0
					}
				},
				releaseTrace: {}
			}
		});

		const url = new URL('http://localhost/api/search?q=test&searchType=movie&enrich=true');
		const response = await GET({ url });
		const data = await response.json();

		expect(data).toHaveProperty('trace');
		expect(data.trace).toHaveProperty('stageOrder');
		expect(data.trace).toHaveProperty('stages');
		expect(data.trace).toHaveProperty('releaseTrace');
		expect(data).toHaveProperty('releases');
		expect(data).toHaveProperty('meta');
	});

	it('does not include trace in non-enriched response', async () => {
		// Non-enrich path uses manager.search(), not searchEnhanced()
		mockGetIndexerManager.mockResolvedValue({
			getIndexers: vi.fn().mockResolvedValue([
				{
					id: 'idx-1',
					name: 'TestIndexer',
					enabled: true,
					enableInteractiveSearch: true,
					definitionId: 'test',
					protocol: 'torrent',
					enableAutomaticSearch: true
				}
			]),
			getDefinitionCapabilities: vi.fn().mockReturnValue({
				search: { available: true, supportedParams: ['q'] },
				movieSearch: { available: true, supportedParams: ['q', 'year'] },
				tvSearch: { available: true, supportedParams: ['q', 'season', 'episode'] },
				categories: [2000]
			}),
			searchEnhanced: mockSearchEnhanced,
			search: vi.fn().mockResolvedValue({
				releases: [],
				totalResults: 0,
				searchTimeMs: 10,
				indexerResults: [],
				rejectedIndexers: []
			})
		});

		const url = new URL('http://localhost/api/search?q=test&searchType=movie');
		const response = await GET({ url });
		const data = await response.json();

		expect(data).not.toHaveProperty('trace');
		expect(data).toHaveProperty('releases');
		expect(data).toHaveProperty('meta');
	});
});
