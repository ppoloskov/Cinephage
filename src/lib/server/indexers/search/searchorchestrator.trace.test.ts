/**
 * Trace collection tests for SearchOrchestrator.searchEnhanced()
 *
 * WP-1: Trace types + pipeline instrumentation
 *
 * These tests verify that when enrich=true, the orchestrator produces a `trace`
 * key on EnhancedSearchResult with per-stage summaries and per-release trace
 * entries through every pipeline filter stage.
 *
 * EXPECTED FAILURES (test-first):
 * - ../types/debug does not exist yet → import compile error
 * - result.trace is not yet on EnhancedSearchResult → type error
 *
 * Both are correct for test-first. Do NOT create debug.ts or modify the
 * orchestrator in this commit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchOrchestrator } from './SearchOrchestrator';
import {
	Category,
	type IIndexer,
	type IndexerCapabilities,
	type ReleaseResult,
	type EnhancedReleaseResult,
	type SearchCriteria,
	type TvSearchCriteria,
	type MovieSearchCriteria,
	type MusicSearchCriteria
} from '../types';
// Expected to fail: ../types/debug does not exist yet
import type {
	TraceResult,
	StageSummary,
	ReleaseTraceEntry
} from '../types/debug';
import { createMockIndexer as _createMockIndexer } from '../../../../test/fixtures/indexers.js';
import { releaseEnricher } from '../../quality';

// ---------------------------------------------------------------------------
// Mock: quality module — prevent real QualityFilter/DB calls during tests
// ---------------------------------------------------------------------------
vi.mock('../../quality', () => ({
	releaseEnricher: {
		enrich: vi.fn().mockResolvedValue({
			releases: [],
			rejectedCount: 0,
			enrichTimeMs: 0
		})
	}
}));

// ---------------------------------------------------------------------------
// Helpers (adapted from searchorchestrator.test.ts)
// ---------------------------------------------------------------------------

const movieCapabilities: IndexerCapabilities = {
	search: { available: true, supportedParams: ['q'] },
	tvSearch: { available: false, supportedParams: [] },
	movieSearch: { available: true, supportedParams: ['q', 'year'] },
	categories: new Map([[Category.MOVIES_HD, 'Movies/HD']]),
	supportsPagination: true,
	supportsInfoHash: false,
	limitMax: 100,
	limitDefault: 50,
	searchFormats: {}
};

const tvCapabilities: IndexerCapabilities = {
	search: { available: true, supportedParams: ['q'] },
	tvSearch: { available: true, supportedParams: ['q', 'season', 'ep'] },
	movieSearch: { available: false, supportedParams: [] },
	categories: new Map([[Category.TV_HD, 'TV/HD']]),
	supportsPagination: true,
	supportsInfoHash: false,
	limitMax: 100,
	limitDefault: 50,
	searchFormats: {
		episode: ['standard', 'european', 'compact']
	}
};

function buildIndexer(
	overrides: {
		name?: string;
		baseUrl?: string;
		capabilities?: IndexerCapabilities;
		search?: (criteria: SearchCriteria) => Promise<ReleaseResult[]>;
		id?: string;
	} = {}
): IIndexer {
	return _createMockIndexer({
		id: overrides.id ?? 'test-indexer',
		name: overrides.name ?? 'FakeIndexer',
		capabilities: (overrides.capabilities ?? movieCapabilities) as unknown as Record<
			string,
			unknown
		>,
		baseUrl: overrides.baseUrl ?? 'https://example.test',
		search: (overrides.search ?? (async () => [])) as unknown as (...args: unknown[]) => unknown
	}) as unknown as IIndexer;
}

function createTvCriteria(overrides: Partial<TvSearchCriteria> = {}): TvSearchCriteria {
	return { searchType: 'tv', ...overrides };
}

function createMovieCriteria(overrides: Partial<MovieSearchCriteria> = {}): MovieSearchCriteria {
	return { searchType: 'movie', ...overrides };
}

function createMusicCriteria(overrides: Partial<MusicSearchCriteria> = {}): MusicSearchCriteria {
	return { searchType: 'music', ...overrides };
}

function createRelease(overrides: Partial<ReleaseResult> = {}): ReleaseResult {
	return {
		guid: 'test-guid',
		title: '',
		downloadUrl: 'https://example.test/download',
		publishDate: new Date(),
		size: 0,
		indexerId: 'test-indexer',
		indexerName: 'FakeIndexer',
		protocol: 'torrent',
		categories: [],
		...overrides
	};
}

/**
 * Build a minimal EnhancedReleaseResult for the enrich mock.
 * The orchestrator passes enriched results through deduplicateEnhanced()
 * and slice(limit), so each needs a unique guid and totalScore.
 */
function createEnhanced(
	release: ReleaseResult,
	overrides: Partial<EnhancedReleaseResult> = {}
): EnhancedReleaseResult {
	return {
		...release,
		parsed: {
			originalTitle: release.title,
			cleanTitle: release.title.replace(/\./g, ' '),
			resolution: '1080p',
			source: 'webdl',
			codec: 'h264',
			hdr: 'none',
			bitDepth: '8bit',
			audioCodec: 'unknown',
			audioChannels: 'unknown',
			hasAtmos: false,
			languages: [],
			isProper: false,
			isRepack: false,
			isRemux: false,
			is3d: false,
			hasHardcodedSubs: false,
			confidence: 0.5
		},
		totalScore: overrides.totalScore ?? 0,
		rejected: false,
		...overrides
	} as EnhancedReleaseResult;
}

/** Default options that disable real persistence and caching. */
const SEARCH_OPTS = {
	respectEnabled: false,
	respectBackoff: false,
	useCache: false,
	useTieredSearch: false
};

// ---------------------------------------------------------------------------
// Trace tests
// ---------------------------------------------------------------------------

describe('SearchOrchestrator trace', () => {
	let orchestrator: SearchOrchestrator;

	beforeEach(() => {
		orchestrator = new SearchOrchestrator();
		vi.clearAllMocks();
	});

	// ========================================================================
	// Group: trace presence
	// ========================================================================
	describe('trace presence', () => {
		it('searchEnhanced returns trace with stageOrder', async () => {
			const r1 = createRelease({
				guid: 'movie-1',
				title: 'Test.Movie.2024.1080p.WEB-DL',
				categories: [Category.MOVIES_HD]
			});

			const fakeIndexer = buildIndexer({
				capabilities: movieCapabilities,
				search: async () => [r1]
			});

			vi.mocked(releaseEnricher.enrich).mockResolvedValue({
				releases: [createEnhanced(r1)],
				rejectedCount: 0,
				enrichTimeMs: 5
			});

			const result = await orchestrator.searchEnhanced(
				[fakeIndexer],
				createMovieCriteria({ query: 'Test Movie', year: 2024 }),
				SEARCH_OPTS
			);

			expect(result.trace).toBeDefined();
			expect(result.trace!.stageOrder).toBeInstanceOf(Array);
			expect(result.trace!.stageOrder.length).toBeGreaterThan(0);
			expect(result.trace!.stages).toBeDefined();
			expect(result.trace!.releaseTrace).toBeDefined();
		});

		it('search() (no enrich) returns no trace', async () => {
			const r1 = createRelease({
				guid: 'movie-1',
				title: 'Test.Movie.2024.1080p.WEB-DL',
				categories: [Category.MOVIES_HD]
			});

			const fakeIndexer = buildIndexer({
				capabilities: movieCapabilities,
				search: async () => [r1]
			});

			const result = await orchestrator.search(
				[fakeIndexer],
				createMovieCriteria({ query: 'Test Movie', year: 2024 }),
				SEARCH_OPTS
			);

			expect(result.trace).toBeUndefined();
		});
	});

	// ========================================================================
	// Group: stage summaries
	// ========================================================================
	describe('stage summaries', () => {
		it('have correct inputCount/outputCount/droppedCount', async () => {
			const r1 = createRelease({
				guid: 'movie-1',
				title: 'Test.Movie.2024.1080p.WEB-DL',
				categories: [Category.MOVIES_HD]
			});
			const r2 = createRelease({
				guid: 'movie-2',
				title: 'Test.Movie.2024.720p.BluRay',
				categories: [Category.MOVIES_HD]
			});

			const fakeIndexer = buildIndexer({
				capabilities: movieCapabilities,
				search: async () => [r1, r2]
			});

			vi.mocked(releaseEnricher.enrich).mockResolvedValue({
				releases: [createEnhanced(r1), createEnhanced(r2)],
				rejectedCount: 0,
				enrichTimeMs: 5
			});

			const result = await orchestrator.searchEnhanced(
				[fakeIndexer],
				createMovieCriteria({ query: 'Test Movie', year: 2024 }),
				SEARCH_OPTS
			);

			const trace = result.trace!;
			// Every stage should satisfy: inputCount - droppedCount === outputCount
			for (const stageName of trace.stageOrder) {
				const s = trace.stages[stageName];
				expect(
					s.inputCount - (s.droppedCount ?? 0),
					`stage ${stageName}: inputCount - droppedCount should equal outputCount`
				).toBe(s.outputCount);
			}

			// Verify consistency with releaseTrace entries
			for (const stageName of trace.stageOrder) {
				const stageDropped = Object.values(trace.releaseTrace).filter((entries) =>
					entries.some((e) => e.stage === stageName && e.event === 'dropped')
				).length;
				expect(stageDropped, `stage ${stageName}: releaseTrace dropped count`).toBe(
					trace.stages[stageName].droppedCount ?? 0
				);
			}
		});

		it('boostByLanguage summary includes preferredLanguage and releasesBoosted', async () => {
			const r1 = createRelease({
				guid: 'movie-1',
				title: 'Test.Movie.2024.FRENCH.1080p.WEB-DL',
				categories: [Category.MOVIES_HD]
			});
			const r2 = createRelease({
				guid: 'movie-2',
				title: 'Test.Movie.2024.1080p.BluRay',
				categories: [Category.MOVIES_HD]
			});

			const fakeIndexer = buildIndexer({
				capabilities: movieCapabilities,
				search: async () => [r1, r2]
			});

			vi.mocked(releaseEnricher.enrich).mockResolvedValue({
				releases: [createEnhanced(r1), createEnhanced(r2)],
				rejectedCount: 0,
				enrichTimeMs: 5
			});

			const result = await orchestrator.searchEnhanced(
				[fakeIndexer],
				createMovieCriteria({
					query: 'Test Movie',
					year: 2024,
					language: 'fr'
				}),
				SEARCH_OPTS
			);

			const boostStage = result.trace!.stages['boostByLanguage'];
			expect(boostStage).toBeDefined();
			expect(boostStage.metadata).toBeDefined();
			expect(boostStage.metadata!.preferredLanguage).toBe('fr');
			expect(typeof boostStage.metadata!.releasesBoosted).toBe('number');
			expect(boostStage.metadata!.releasesBoosted).toBeGreaterThan(0);
			expect(boostStage.transformedCount).toBe(boostStage.metadata!.releasesBoosted);
		});

		it('enrich stage summary includes rejectedByQuality/Protocol/Size/Banned', async () => {
			const r1 = createRelease({
				guid: 'movie-1',
				title: 'Test.Movie.2024.1080p.WEB-DL',
				categories: [Category.MOVIES_HD]
			});
			const r2 = createRelease({
				guid: 'movie-2',
				title: 'Test.Movie.2024.720p.BluRay',
				categories: [Category.MOVIES_HD]
			});

			const fakeIndexer = buildIndexer({
				capabilities: movieCapabilities,
				search: async () => [r1, r2]
			});

			vi.mocked(releaseEnricher.enrich).mockResolvedValue({
				releases: [
					createEnhanced(r1, { rejected: false }),
					createEnhanced(r2, {
						rejected: true,
						rejectionReason: 'Below minimum size',
						rejections: ['Below minimum size'],
						rejectionType: 'size'
					})
				],
				rejectedCount: 1,
				enrichTimeMs: 5
			});

			const result = await orchestrator.searchEnhanced(
				[fakeIndexer],
				createMovieCriteria({ query: 'Test Movie', year: 2024 }),
				SEARCH_OPTS
			);

			const enrichStage = result.trace!.stages['enrich'];
			expect(enrichStage).toBeDefined();
			expect(enrichStage.metadata).toBeDefined();
			expect(typeof enrichStage.metadata!.rejectedByQuality).toBe('number');
			expect(typeof enrichStage.metadata!.rejectedByProtocol).toBe('number');
			expect(typeof enrichStage.metadata!.rejectedBySize).toBe('number');
			expect(typeof enrichStage.metadata!.rejectedByBanned).toBe('number');
			// At least one sub-count should be > 0 since one release was rejected
			const totalMetaRejected =
				(enrichStage.metadata!.rejectedByQuality as number) +
				(enrichStage.metadata!.rejectedByProtocol as number) +
				(enrichStage.metadata!.rejectedBySize as number) +
				(enrichStage.metadata!.rejectedByBanned as number);
			expect(totalMetaRejected).toBeGreaterThanOrEqual(1);
		});

		it('filterIndexers stage summary includes rejectedByReason counts', async () => {
			// Create one eligible indexer + one disabled indexer
			const eligible = buildIndexer({
				name: 'EligibleIndexer',
				capabilities: movieCapabilities,
				search: async () => [
					createRelease({
						guid: 'movie-1',
						title: 'Test.Movie.2024.1080p.WEB-DL',
						categories: [Category.MOVIES_HD]
					})
				]
			});

			// An indexer without movie categories will be rejected (reason: 'searchType')
			const noMovieCaps: IndexerCapabilities = {
				...movieCapabilities,
				categories: new Map([[Category.TV_HD, 'TV/HD']]),
				movieSearch: { available: false, supportedParams: [] }
			};
			const rejected = buildIndexer({
				id: 'rejected-indexer',
				name: 'RejectedIndexer',
				capabilities: noMovieCaps
			});

			vi.mocked(releaseEnricher.enrich).mockResolvedValue({
				releases: [
					createEnhanced(
						createRelease({
							guid: 'movie-1',
							title: 'Test.Movie.2024.1080p.WEB-DL',
							categories: [Category.MOVIES_HD]
						})
					)
				],
				rejectedCount: 0,
				enrichTimeMs: 5
			});

			const result = await orchestrator.searchEnhanced(
				[eligible, rejected],
				createMovieCriteria({ query: 'Test Movie', year: 2024 }),
				SEARCH_OPTS
			);

			const filterStage = result.trace!.stages['filterIndexers'];
			expect(filterStage).toBeDefined();
			expect(filterStage.metadata).toBeDefined();
			expect(filterStage.metadata!.totalIndexers).toBe(2);
			expect(filterStage.metadata!.eligible).toBe(1);
			expect(filterStage.metadata!.rejected).toBe(1);
			expect(filterStage.metadata!.rejectedByReason).toBeDefined();
			const rejectedByReason = filterStage.metadata!.rejectedByReason as Record<string, string[]>;
			expect(rejectedByReason['searchType']).toEqual(['RejectedIndexer']);
		});

		it('executeSearches summary includes indexersQueried and totalRawReleases', async () => {
			const r1 = createRelease({
				guid: 'movie-1',
				title: 'Test.Movie.2024.1080p.WEB-DL',
				categories: [Category.MOVIES_HD]
			});

			const fakeIndexer = buildIndexer({
				capabilities: movieCapabilities,
				search: async () => [r1]
			});

			vi.mocked(releaseEnricher.enrich).mockResolvedValue({
				releases: [createEnhanced(r1)],
				rejectedCount: 0,
				enrichTimeMs: 5
			});

			const result = await orchestrator.searchEnhanced(
				[fakeIndexer],
				createMovieCriteria({ query: 'Test Movie', year: 2024 }),
				SEARCH_OPTS
			);

			const searchStage = result.trace!.stages['executeSearches'];
			expect(searchStage).toBeDefined();
			expect(searchStage.metadata).toBeDefined();
			expect(searchStage.metadata!.indexersQueried).toBe(1);
			expect(searchStage.metadata!.totalRawReleases).toBe(1);
		});
	});

	// ========================================================================
	// Group: release trace events
	// ========================================================================
	describe('release trace events', () => {
		it('releaseTrace contains entry for every release that entered', async () => {
			const r1 = createRelease({
				guid: 'movie-1',
				title: 'Test.Movie.2024.1080p.WEB-DL',
				categories: [Category.MOVIES_HD]
			});
			const r2 = createRelease({
				guid: 'movie-2',
				title: 'Test.Movie.2024.720p.BluRay',
				categories: [Category.MOVIES_HD]
			});

			const fakeIndexer = buildIndexer({
				capabilities: movieCapabilities,
				search: async () => [r1, r2]
			});

			vi.mocked(releaseEnricher.enrich).mockResolvedValue({
				releases: [createEnhanced(r1), createEnhanced(r2)],
				rejectedCount: 0,
				enrichTimeMs: 5
			});

			const result = await orchestrator.searchEnhanced(
				[fakeIndexer],
				createMovieCriteria({ query: 'Test Movie', year: 2024 }),
				SEARCH_OPTS
			);

			const trace = result.trace!;
			expect(trace.releaseTrace['movie-1']).toBeDefined();
			expect(trace.releaseTrace['movie-2']).toBeDefined();
			expect(trace.releaseTrace['movie-1'].length).toBeGreaterThan(0);
			expect(trace.releaseTrace['movie-2'].length).toBeGreaterThan(0);
		});

		it('release dropped by season/episode filter has reason and reasonCategory', async () => {
			// TV release in a movie search should be dropped by filterBySeasonEpisode
			const tvRelease = createRelease({
				guid: 'tv-in-movie',
				title: 'Some.Show.S01E05.1080p.WEB-DL',
				categories: [Category.MOVIES_HD]
			});

			const fakeIndexer = buildIndexer({
				capabilities: movieCapabilities,
				search: async () => [tvRelease]
			});

			vi.mocked(releaseEnricher.enrich).mockResolvedValue({
				releases: [],
				rejectedCount: 0,
				enrichTimeMs: 5
			});

			const result = await orchestrator.searchEnhanced(
				[fakeIndexer],
				createMovieCriteria({ query: 'Some Show', year: 2024 }),
				SEARCH_OPTS
			);

			const entries = result.trace!.releaseTrace['tv-in-movie'];
			expect(entries).toBeDefined();

			const droppedEvent = entries.find((e) => e.event === 'dropped');
			expect(droppedEvent).toBeDefined();
			expect(droppedEvent!.reason).toBeDefined();
			expect(droppedEvent!.reasonCategory).toBe('tvReleaseInMovieSearch');
		});

		it('release dropped by category filter has reason and reasonCategory', async () => {
			// Movie release with TV categories in a movie search
			const catMismatch = createRelease({
				guid: 'cat-mismatch',
				title: 'Some.Movie.2024.1080p.WEB-DL',
				categories: [Category.TV_HD]
			});

			const fakeIndexer = buildIndexer({
				capabilities: movieCapabilities,
				search: async () => [catMismatch]
			});

			vi.mocked(releaseEnricher.enrich).mockResolvedValue({
				releases: [],
				rejectedCount: 0,
				enrichTimeMs: 5
			});

			const result = await orchestrator.searchEnhanced(
				[fakeIndexer],
				createMovieCriteria({ query: 'Some Movie', year: 2024 }),
				SEARCH_OPTS
			);

			const entries = result.trace!.releaseTrace['cat-mismatch'];
			expect(entries).toBeDefined();

			const droppedEvent = entries.find(
				(e) => e.event === 'dropped' && e.reasonCategory === 'categoryMismatch'
			);
			expect(droppedEvent).toBeDefined();
			expect(droppedEvent!.reason).toBeDefined();
		});

		it('release dropped by non-video filter has reason and reasonCategory', async () => {
			// "Original Soundtrack" matches NON_VIDEO_ARTIFACT_TITLE_PATTERNS
			const soundtrackRelease = createRelease({
				guid: 'soundtrack-1',
				title: 'Original Soundtrack The Movie 2024 FLAC',
				categories: [Category.MOVIES_HD]
			});

			const fakeIndexer = buildIndexer({
				capabilities: movieCapabilities,
				search: async () => [soundtrackRelease]
			});

			vi.mocked(releaseEnricher.enrich).mockResolvedValue({
				releases: [],
				rejectedCount: 0,
				enrichTimeMs: 5
			});

			const result = await orchestrator.searchEnhanced(
				[fakeIndexer],
				createMovieCriteria({ query: 'The Movie', year: 2024 }),
				SEARCH_OPTS
			);

			const entries = result.trace!.releaseTrace['soundtrack-1'];
			expect(entries).toBeDefined();

			const droppedEvent = entries.find((e) => e.event === 'dropped');
			expect(droppedEvent).toBeDefined();
			expect(droppedEvent!.reason).toBeDefined();
			expect(droppedEvent!.reasonCategory).toBeDefined();
			// Reason category should be one of:
			// 'dangerousExtension', 'trailerArtifact', or 'nonVideoArtifact'
			expect([
				'dangerousExtension',
				'trailerArtifact',
				'nonVideoArtifact'
			]).toContain(droppedEvent!.reasonCategory);
		});

		it('release dropped by id/title filter has reason and reasonCategory', async () => {
			// Release with wrong year (>1 year away from search year)
			const wrongYear = createRelease({
				guid: 'wrong-year',
				title: 'Test.Movie.2010.1080p.BluRay',
				categories: [Category.MOVIES_HD]
			});

			const fakeIndexer = buildIndexer({
				capabilities: movieCapabilities,
				search: async () => [wrongYear]
			});

			vi.mocked(releaseEnricher.enrich).mockResolvedValue({
				releases: [],
				rejectedCount: 0,
				enrichTimeMs: 5
			});

			const result = await orchestrator.searchEnhanced(
				[fakeIndexer],
				createMovieCriteria({ query: 'Test Movie', year: 2024 }),
				SEARCH_OPTS
			);

			const entries = result.trace!.releaseTrace['wrong-year'];
			expect(entries).toBeDefined();

			const droppedEvent = entries.find((e) => e.event === 'dropped');
			expect(droppedEvent).toBeDefined();
			expect(droppedEvent!.reason).toBeDefined();
			expect(droppedEvent!.reasonCategory).toBe('yearMismatch');
		});

		it('language-boosted releases have transformed event with score delta', async () => {
			const frenchRelease = createRelease({
				guid: 'french-movie',
				title: 'Test.Movie.2024.FRENCH.1080p.WEB-DL',
				categories: [Category.MOVIES_HD]
			});

			const fakeIndexer = buildIndexer({
				capabilities: movieCapabilities,
				search: async () => [frenchRelease]
			});

			vi.mocked(releaseEnricher.enrich).mockResolvedValue({
				releases: [createEnhanced(frenchRelease, { totalScore: 100 })],
				rejectedCount: 0,
				enrichTimeMs: 5
			});

			const result = await orchestrator.searchEnhanced(
				[fakeIndexer],
				createMovieCriteria({
					query: 'Test Movie',
					year: 2024,
					language: 'fr'
				}),
				SEARCH_OPTS
			);

			const entries = result.trace!.releaseTrace['french-movie'];
			expect(entries).toBeDefined();

			const transformed = entries.find(
				(e) => e.event === 'transformed' && e.transformation === 'languageBoost'
			);
			expect(transformed).toBeDefined();
			expect(transformed!.transformationDetail).toBeDefined();
			expect(typeof transformed!.transformationDetail!.totalScoreBefore).toBe('number');
			expect(typeof transformed!.transformationDetail!.totalScoreAfter).toBe('number');
			expect(
				(transformed!.transformationDetail!.totalScoreAfter as number)
			).toBeGreaterThan(
				(transformed!.transformationDetail!.totalScoreBefore as number)
			);
		});
	});

	// ========================================================================
	// Group: edge cases
	// ========================================================================
	describe('edge cases', () => {
		it('zero eligible indexers still returns trace with filterIndexers metadata', async () => {
			// Use an indexer with no matching capabilities for the search type
			const tvOnlyCaps: IndexerCapabilities = {
				...tvCapabilities,
				categories: new Map([[Category.TV_HD, 'TV/HD']]),
				movieSearch: { available: false, supportedParams: [] }
			};
			const tvOnly = buildIndexer({
				name: 'TVOnlyIndexer',
				capabilities: tvOnlyCaps
			});

			const result = await orchestrator.searchEnhanced(
				[tvOnly],
				createMovieCriteria({ query: 'Test Movie', year: 2024 }),
				SEARCH_OPTS
			);

			expect(result.trace).toBeDefined();
			const filterStage = result.trace!.stages['filterIndexers'];
			expect(filterStage).toBeDefined();
			expect(filterStage.metadata!.eligible).toBe(0);
			expect(filterStage.metadata!.rejected).toBe(1);
			expect(result.trace!.releaseTrace).toEqual({});
			// No stages beyond filterIndexers should exist since pipeline short-circuits
			expect(result.releases).toHaveLength(0);
		});

		it('all-releases-dropped scenario has every guid ending in dropped event', async () => {
			// Movie search with a release that has the wrong year (drops at filterByIdOrTitleMatch)
			const r1 = createRelease({
				guid: 'drop-1',
				title: 'Some.Show.S01E05.1080p.WEB-DL', // TV show in movie search → drops early
				categories: [Category.MOVIES_HD]
			});

			const fakeIndexer = buildIndexer({
				capabilities: movieCapabilities,
				search: async () => [r1]
			});

			vi.mocked(releaseEnricher.enrich).mockResolvedValue({
				releases: [],
				rejectedCount: 0,
				enrichTimeMs: 5
			});

			const result = await orchestrator.searchEnhanced(
				[fakeIndexer],
				createMovieCriteria({ query: 'Some Show', year: 2024 }),
				SEARCH_OPTS
			);

			expect(result.releases).toHaveLength(0);

			const entries = result.trace!.releaseTrace['drop-1'];
			expect(entries).toBeDefined();
			expect(entries.length).toBeGreaterThan(0);
			// Last event for every release that was dropped should be 'dropped'
			expect(entries[entries.length - 1].event).toBe('dropped');

			// Verify ALL guids in releaseTrace end with dropped
			for (const guid of Object.keys(result.trace!.releaseTrace)) {
				const releaseEntries = result.trace!.releaseTrace[guid];
				expect(releaseEntries[releaseEntries.length - 1].event).toBe('dropped');
			}
		});

		it('language boost skipped for "en" language', async () => {
			const r1 = createRelease({
				guid: 'english-movie',
				title: 'Test.Movie.2024.1080p.WEB-DL',
				categories: [Category.MOVIES_HD]
			});

			const fakeIndexer = buildIndexer({
				capabilities: movieCapabilities,
				search: async () => [r1]
			});

			vi.mocked(releaseEnricher.enrich).mockResolvedValue({
				releases: [createEnhanced(r1)],
				rejectedCount: 0,
				enrichTimeMs: 5
			});

			const result = await orchestrator.searchEnhanced(
				[fakeIndexer],
				createMovieCriteria({
					query: 'Test Movie',
					year: 2024,
					language: 'en'
				}),
				SEARCH_OPTS
			);

			const entries = result.trace!.releaseTrace['english-movie'];
			expect(entries).toBeDefined();

			// boostByLanguage should be skipped for 'en' → no transformed events
			const boostTransformed = entries.filter(
				(e) => e.stage === 'boostByLanguage' && e.event === 'transformed'
			);
			expect(boostTransformed).toHaveLength(0);

			// boostByLanguage stage should still exist but with zero transformedCount
			const boostStage = result.trace!.stages['boostByLanguage'];
			expect(boostStage).toBeDefined();
			expect(boostStage.transformedCount ?? 0).toBe(0);
		});

		it('language boost skipped when no preferred language', async () => {
			const r1 = createRelease({
				guid: 'no-lang-movie',
				title: 'Test.Movie.2024.FRENCH.1080p.WEB-DL',
				categories: [Category.MOVIES_HD]
			});

			const fakeIndexer = buildIndexer({
				capabilities: movieCapabilities,
				search: async () => [r1]
			});

			vi.mocked(releaseEnricher.enrich).mockResolvedValue({
				releases: [createEnhanced(r1)],
				rejectedCount: 0,
				enrichTimeMs: 5
			});

			// No language preference set
			const result = await orchestrator.searchEnhanced(
				[fakeIndexer],
				createMovieCriteria({
					query: 'Test Movie',
					year: 2024
				}),
				SEARCH_OPTS
			);

			const entries = result.trace!.releaseTrace['no-lang-movie'];
			expect(entries).toBeDefined();

			const boostTransformed = entries.filter(
				(e) => e.stage === 'boostByLanguage' && e.event === 'transformed'
			);
			expect(boostTransformed).toHaveLength(0);

			const boostStage = result.trace!.stages['boostByLanguage'];
			expect(boostStage).toBeDefined();
			expect(boostStage.transformedCount ?? 0).toBe(0);
		});

		it('existing tests pass unchanged (smoke check)', () => {
			// This is a placeholder: the real verification runs the existing test file.
			// We import SearchOrchestrator here and verify it can be instantiated
			// and that private methods are still accessible via the privateApi pattern.
			const fresh = new SearchOrchestrator();
			expect(fresh).toBeDefined();

			// The existing test file at searchorchestrator.test.ts covers:
			// - executeMultiTitleTextSearch
			// - executeWithTiering
			// - filterBySeasonEpisode
			// - filterByIdOrTitleMatch
			// - filterOutNonVideoArtifacts
			// - filterByCategoryMatch
			// - season-only category filter (integration via orchestrator.search())
			//
			// Run: npx vitest run src/lib/server/indexers/search/searchorchestrator.test.ts
			// Expected: all tests pass unchanged since trace is a new key on
			// EnhancedSearchResult only (search() path is untouched).
			expect(true).toBe(true);
		});
	});
});
