import { MediaRequest } from "../deepbrid/apiClient";
import { SourceCandidate } from "./types";
import { ParsedRelease, parseRelease } from "./parseRelease";

export type MediaMetadata = {
  title?: string;
  aliases?: string[];
  year?: number;
  countries?: string[];
  isAnime?: boolean;
};

export type MatchResult = {
  score: number;
  reason: string;
};

export function normalizeComparableTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019`]/g, "")
    .replace(/\b(?:[A-Za-z][.*]){2,}[A-Za-z]\b/g, acronym => acronym.replace(/[.*]/g, ""))
    .replace(/&/g, " and ")
    .replace(/\b(the|a|an)\b/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function tokens(value: string): string[] {
  return normalizeComparableTitle(value).split(" ").filter(token => token.length > 1 || /^\d$/.test(token));
}

function titleSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokens(left));
  const rightTokens = new Set(tokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap++;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function releaseTitleStem(rawTitle: string): string {
  return rawTitle
    .replace(/\bS\d{1,2}\s*E\d{1,3}.*$/i, " ")
    .replace(/\b\d{1,2}x\d{1,3}.*$/i, " ")
    .replace(/\bSeason\s*\d{1,2}.*$/i, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b(?:2160p|1080p|720p|480p|4k|uhd|web-?dl|webrip|hdtv|blu-?ray|remux).*/i, " ")
    .replace(/[-_.]+/g, " ")
    .trim();
}

function bestTitleSimilarity(parsed: ParsedRelease, rawTitle: string, metadata?: MediaMetadata): number {
  const titles = [metadata?.title, ...(metadata?.aliases || [])].filter((title): title is string => Boolean(title));
  if (titles.length === 0) return 0.5;
  const stem = releaseTitleStem(rawTitle);
  return Math.max(...titles.map(title => Math.max(
    titleSimilarity(parsed.normalizedTitle, title),
    titleSimilarity(rawTitle, title),
    titleSimilarity(stem, title)
  )));
}

function metadataContains(metadata: MediaMetadata | undefined, phrase: string): boolean {
  const values = [metadata?.title, ...(metadata?.aliases || [])].filter((value): value is string => Boolean(value));
  return values.some(value => normalizeComparableTitle(value).includes(phrase));
}

function applyAnimeUniversePenalty(rawTitle: string, metadata: MediaMetadata | undefined): { penalty: number; reasons: string[] } {
  if (!metadata?.isAnime) return { penalty: 0, reasons: [] };
  const normalizedRaw = normalizeComparableTitle(rawTitle);
  const conflictTerms = [
    "shippuden",
    "boruto",
    "rock lee",
    "ninja pals",
    "spin off",
    "brotherhood",
    "dragon ball z",
    "dragon ball daima",
    "dragon ball gt",
    "dragon ball kai",
    "dragon ball super",
    "live action"
  ];
  const conflicts = conflictTerms.filter(term => normalizedRaw.includes(term) && !metadataContains(metadata, term));
  return {
    penalty: conflicts.length * 1200,
    reasons: conflicts.map(term => `anime-conflict:${term}`)
  };
}

export function scoreReleaseMatch(rawTitle: string, media: MediaRequest, parsed: ParsedRelease = parseRelease(rawTitle), metadata?: MediaMetadata): MatchResult {
  const similarity = bestTitleSimilarity(parsed, rawTitle, metadata);
  let score = Math.round(similarity * 500);
  const reasons: string[] = [];

  if (similarity >= 0.8) {
    score += 500;
    reasons.push("title");
  } else if (similarity >= 0.45) {
    score += 220;
    reasons.push("partial-title");
  } else {
    reasons.push("weak-title");
  }

  if (media.type === "series") {
    const releaseYear = parseInt(rawTitle.match(/\b(19|20)\d{2}\b/)?.[0] || "", 10);
    if (metadata?.year && Number.isFinite(releaseYear)) {
      if (releaseYear === metadata.year) {
        score += 180;
        reasons.push("year");
      } else {
        score -= metadata.isAnime ? 900 : 320;
        reasons.push("year-mismatch");
      }
    }

    const normalizedRaw = normalizeComparableTitle(rawTitle);
    const countries = (metadata?.countries || []).map(country => country.toLowerCase());
    const isUsSeries = countries.some(country => country.includes("united states") || country === "us" || country === "usa");
    if (isUsSeries && /\b(?:us|u s|usa)\b/.test(normalizedRaw)) {
      score += 120;
      reasons.push("country");
    }

    const animeUniverse = applyAnimeUniversePenalty(rawTitle, metadata);
    if (animeUniverse.penalty > 0) {
      score -= animeUniverse.penalty;
      reasons.push(...animeUniverse.reasons);
    }

    const seasonMatches = parsed.season === media.season || parsed.season === undefined;
    const directEpisode = parsed.episode === media.episode;
    const rangeEpisode = Boolean(parsed.episodeRange && media.episode && parsed.episodeRange.start <= media.episode && parsed.episodeRange.end >= media.episode);

    if (parsed.season === media.season && directEpisode) {
      score += 500;
      reasons.push("episode");
    } else if (seasonMatches && rangeEpisode) {
      score += 360;
      reasons.push("episode-range");
    } else if (parsed.season === media.season && parsed.seasonPack) {
      score += 260;
      reasons.push("season-pack");
    } else if (parsed.absoluteEpisode === media.episode) {
      score += metadata?.isAnime ? 480 : 190;
      reasons.push("absolute-episode");
    } else if (parsed.episode !== undefined || parsed.season !== undefined || parsed.absoluteEpisode !== undefined) {
      score -= metadata?.isAnime ? 1000 : 250;
      reasons.push("episode-mismatch");
    } else {
      score -= 80;
      reasons.push("uncertain-episode");
    }
  }

  return { score: Math.max(0, score), reason: reasons.join(",") };
}

export function dedupeCandidates(candidates: SourceCandidate[]): SourceCandidate[] {
  const byKey = new Map<string, SourceCandidate>();
  for (const candidate of candidates) {
    const parsed = parseRelease(candidate.title || candidate.displayName || "");
    const normalizedTitle = candidate.normalizedTitle || parsed.normalizedTitle || normalizeComparableTitle(candidate.title);
    const size = candidate.sizeBytes || parsed.sizeBytes || 0;
    const sizeKey = size > 0 ? String(size) : "unknown";
    const key = `${normalizeComparableTitle(normalizedTitle)}|${sizeKey}`;
    const existing = byKey.get(key);
    if (!existing || compareCandidates(candidate, existing) < 0) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()];
}

function matchRank(candidate: SourceCandidate): number {
  return candidate.matchScore && Number.isFinite(candidate.matchScore) ? candidate.matchScore : 0;
}

export function compareCandidates(a: SourceCandidate, b: SourceCandidate): number {
  const libraryDiff = libraryRank(a) - libraryRank(b);
  if (libraryDiff !== 0) return libraryDiff;

  if (a.status === "ready" && b.status !== "ready") return -1;
  if (b.status === "ready" && a.status !== "ready") return 1;

  const matchDiff = matchRank(b) - matchRank(a);
  if (matchDiff !== 0) return matchDiff;

  const sourceDiff = sourcePriority(a) - sourcePriority(b);
  if (sourceDiff !== 0) return sourceDiff;

  const qualityDiff = qualityRank(b.quality) - qualityRank(a.quality);
  if (qualityDiff !== 0) return qualityDiff;

  const resDiff = resolutionRank(b.resolution) - resolutionRank(a.resolution);
  if (resDiff !== 0) return resDiff;

  const sizeDiff = sizeRank(b) - sizeRank(a);
  if (sizeDiff !== 0) return sizeDiff;

  return b.score - a.score;
}

export function resolutionRank(resolution: string | undefined): number {
  if (resolution === "2160p" || resolution === "4k") return 4;
  if (resolution === "1080p") return 3;
  if (resolution === "720p") return 2;
  if (resolution === "480p" || resolution === "SD") return 1;
  return 0;
}

function libraryRank(candidate: SourceCandidate): number {
  return candidate.origin === "deepbrid-torrent-library" ? 0 : 1;
}

function sizeRank(candidate: SourceCandidate): number {
  return candidate.sizeBytes && Number.isFinite(candidate.sizeBytes) ? candidate.sizeBytes : 0;
}

function sourcePriority(candidate: SourceCandidate): number {
  if (candidate.origin === "deepbrid-official") return 0;
  if (candidate.origin === "deepbrid-usenet-finder") return 1;
  if (candidate.origin === "easynews-direct") return 2;
  if (candidate.origin === "newshosting-direct") return 3;
  if (candidate.origin === "nexus-miatrix") return 4;
  return 5;
}

function qualityRank(quality: SourceCandidate["quality"]): number {
  if (quality === "REMUX") return 5;
  if (quality === "BluRay") return 4;
  if (quality === "WEB-DL") return 3;
  if (quality === "WEBRip") return 2;
  if (quality === "HDTV") return 1;
  return 0;
}
