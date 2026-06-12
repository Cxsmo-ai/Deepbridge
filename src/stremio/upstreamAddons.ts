import { nanoid } from "nanoid";
import { request } from "undici";
import { MediaRequest } from "../deepbrid/apiClient";
import { makeMediaKey } from "../core/mediaKey";
import { parseRelease } from "../core/parseRelease";
import { SourceCandidate } from "../core/types";

type UpstreamStats = {
  startedAt: string;
  finishedAt: string;
  configured: number;
  fulfilled: number;
  failed: number;
  rawStreams: number;
  candidates: number;
  directCandidates: number;
  magnetCandidates: number;
  skippedNeedsAdd: number;
  skippedP2p: number;
  errors: Record<string, number>;
};

let lastUpstreamStats: UpstreamStats = {
  startedAt: "",
  finishedAt: "",
  configured: 0,
  fulfilled: 0,
  failed: 0,
  rawStreams: 0,
  candidates: 0,
  directCandidates: 0,
  magnetCandidates: 0,
  skippedNeedsAdd: 0,
  skippedP2p: 0,
  errors: {}
};

export function getLastUpstreamAddonStats(): UpstreamStats {
  return lastUpstreamStats;
}

function addonBase(url: string): string {
  return String(url || "").trim().replace(/\/manifest\.json(?:\?.*)?$/i, "").replace(/\/+$/, "");
}

function streamPath(media: MediaRequest): string {
  if (media.type === "movie") return `/stream/movie/${encodeURIComponent(media.imdbId)}.json`;
  return `/stream/series/${encodeURIComponent(`${media.imdbId}:${media.season}:${media.episode}`)}.json`;
}

function magnetFromStream(stream: any): string | undefined {
  const url = String(stream?.url || stream?.externalUrl || "");
  if (/^magnet:\?/i.test(url)) return url;
  const infoHash = String(stream?.infoHash || stream?.info_hash || "").trim();
  if (/^[a-f0-9]{40}$/i.test(infoHash) || /^[a-z2-7]{32}$/i.test(infoHash)) {
    const trackers = Array.isArray(stream?.sources)
      ? stream.sources.filter((source: any) => /^tracker:/i.test(String(source))).map((source: string) => `&tr=${encodeURIComponent(source.replace(/^tracker:/i, ""))}`).join("")
      : "";
    return `magnet:?xt=urn:btih:${encodeURIComponent(infoHash)}${trackers}`;
  }
  return undefined;
}

function directUrlFromStream(stream: any): string | undefined {
  const url = String(stream?.url || stream?.externalUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) return undefined;
  if (/^magnet:\?/i.test(url)) return undefined;
  return url;
}

function isP2pTorrentStream(stream: any, url?: string): boolean {
  const haystack = [
    stream?.name,
    stream?.title,
    stream?.description,
    stream?.behaviorHints?.filename,
    url
  ].map(value => String(value || "")).join("\n");
  return /\bP2P\b|☁️|peer|seeders?|\/p\//i.test(haystack);
}

function encodePayload(payload: any): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function titleFromStream(stream: any, fallback: string): string {
  return String(stream?.title || stream?.name || stream?.description || fallback || "Stremio addon torrent");
}

export async function getUpstreamAddonSources(media: MediaRequest, userConfig: any, baseUrl: string, token: string): Promise<SourceCandidate[]> {
  const startedAt = Date.now();
  const directLinksOnly = userConfig?.directLinksOnly !== false;
  const addons = Array.isArray(userConfig?.stremioAddons)
    ? userConfig.stremioAddons.filter((addon: any) => addon?.enabled !== false && addon?.url)
    : [];
  const stats: UpstreamStats = {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: "",
    configured: addons.length,
    fulfilled: 0,
    failed: 0,
    rawStreams: 0,
    candidates: 0,
    directCandidates: 0,
    magnetCandidates: 0,
    skippedNeedsAdd: 0,
    skippedP2p: 0,
    errors: {}
  };
  const candidates: SourceCandidate[] = [];

  await Promise.all(addons.map(async (addon: any) => {
    const name = String(addon.name || "Stremio Addon");
    const maxResults = Math.max(0, Math.min(Number(addon.maxResults || 20) || 20, 80));
    try {
      const res = await request(`${addonBase(addon.url)}${streamPath(media)}`, {
        signal: AbortSignal.timeout(Number(addon.timeoutMs || userConfig?.upstreamAddonTimeout || 10000) || 10000)
      });
      const body = await res.body.json() as any;
      const streams = Array.isArray(body?.streams) ? body.streams : [];
      stats.fulfilled++;
      stats.rawStreams += streams.length;
      for (const stream of streams.slice(0, maxResults)) {
        const directUrl = directUrlFromStream(stream);
        const magnet = magnetFromStream(stream);
        if (isP2pTorrentStream(stream, directUrl)) {
          stats.skippedP2p++;
          continue;
        }
        if (directUrl) {
          const title = titleFromStream(stream, name);
          const parsed = parseRelease(title);
          candidates.push({
            id: nanoid(),
            mediaType: media.type,
            imdbId: media.imdbId,
            season: media.season,
            episode: media.episode,
            mediaKey: makeMediaKey(media),
            origin: "stremio-addon-torrent",
            title,
            displayName: `[${name} Direct]`,
            status: "ready",
            playableUrl: directUrl,
            resolution: parsed.resolution,
            quality: parsed.quality,
            codec: parsed.codec,
            hdr: parsed.hdr,
            audio: parsed.audio,
            releaseGroup: parsed.releaseGroup,
            normalizedTitle: parsed.normalizedTitle,
            parsedSeason: parsed.season,
            parsedEpisode: parsed.episode,
            absoluteEpisode: parsed.absoluteEpisode,
            seasonPack: parsed.seasonPack,
            score: 3350,
            createdAt: new Date().toISOString()
          });
          stats.candidates++;
          stats.directCandidates++;
          continue;
        }

        if (!magnet) continue;
        stats.magnetCandidates++;
        if (directLinksOnly) {
          stats.skippedNeedsAdd++;
          continue;
        }
        const title = titleFromStream(stream, name);
        const parsed = parseRelease(title);
        const payload = encodePayload({ magnet, title, season: media.season, episode: media.episode, addon: name });
        candidates.push({
          id: nanoid(),
          mediaType: media.type,
          imdbId: media.imdbId,
          season: media.season,
          episode: media.episode,
          mediaKey: makeMediaKey(media),
          origin: "stremio-addon-torrent",
          title,
          displayName: `[${name}]`,
          status: "ready",
          playableUrl: `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(token)}/torrent/add/${payload}`,
          resolution: parsed.resolution,
          quality: parsed.quality,
          codec: parsed.codec,
          hdr: parsed.hdr,
          audio: parsed.audio,
          releaseGroup: parsed.releaseGroup,
          normalizedTitle: parsed.normalizedTitle,
          parsedSeason: parsed.season,
          parsedEpisode: parsed.episode,
          absoluteEpisode: parsed.absoluteEpisode,
          seasonPack: parsed.seasonPack,
          score: 3300,
          createdAt: new Date().toISOString()
        });
        stats.candidates++;
      }
    } catch (error) {
      stats.failed++;
      const key = error instanceof Error && /timeout|aborted/i.test(error.message) ? "timeout" : "error";
      stats.errors[key] = (stats.errors[key] || 0) + 1;
    }
  }));

  stats.finishedAt = new Date().toISOString();
  lastUpstreamStats = stats;
  return candidates;
}
