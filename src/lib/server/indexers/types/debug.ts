/**
 * Debug trace types for the search pipeline.
 *
 * When an enhanced search (searchEnhanced) runs, it optionally collects per-stage
 * summaries and per-release trace entries that describe every pipeline decision.
 * The resulting TraceResult is attached to EnhancedSearchResult.trace.
 */

export interface StageSummary {
	index: number;
	inputCount: number;
	outputCount: number;
	droppedCount: number;
	transformedCount?: number;
	durationMs?: number;
	metadata?: Record<string, unknown>;
}

export interface ReleaseTraceEntry {
	stage: string;
	event: 'entered' | 'passed' | 'dropped' | 'transformed';
	ts: number;
	title: string;
	indexerId: string;
	indexerName: string;
	reason?: string;
	reasonCategory?: string;
	transformation?: string;
	transformationDetail?: Record<string, unknown>;
}

export interface TraceResult {
	stageOrder: string[];
	stages: Record<string, StageSummary>;
	releaseTrace: Record<string, ReleaseTraceEntry[]>;
}
