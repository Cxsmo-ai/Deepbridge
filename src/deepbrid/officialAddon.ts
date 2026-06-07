import { DeepbridClient, MediaRequest } from "./apiClient";
import { SourceCandidate } from "../core/types";
import { makeMediaKey } from "../core/mediaKey";
import { parseRelease } from "../core/parseRelease";
import { normalizeComparableTitle, scoreReleaseMatch } from "../core/releaseMatch";
import { nanoid } from "nanoid";
import { request } from "undici";

function cleanOfficialLine(value: string): string {
  return value
    .replace(/^[\s🎥⚡📦📺📥✅]+/u, "")
    .replace(/\b(?:premium|deepbrid|cached|ready|stream)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getMediaDisplayLabel(media: MediaRequest): Promise<string> {
  let title = "";
  let year: number | undefined;

  if (media.imdbId.startsWith("tt")) {
    try {
      const res = await request(`https://v3-cinemeta.strem.io/meta/${media.type}/${media.imdbId}.json`, {
        signal: AbortSignal.timeout(2500)
      });
      const data = await res.body.json() as any;
      const meta = data?.meta;
      title = meta?.name || "";
      const parsedYear = parseInt(String(meta?.releaseInfo || meta?.year || "").match(/\b(19|20)\d{2}\b/)?.[0] || "", 10);
      year = Number.isFinite(parsedYear) ? parsedYear : undefined;
    } catch {
    }
  }

  const baseTitle = title || media.imdbId;
  const yearSuffix = year ? ` (${year})` : "";
  const episodeSuffix = media.type === "series" && media.season && media.episode
    ? ` S${String(media.season).padStart(2, "0")}E${String(media.episode).padStart(2, "0")}`
    : "";

  return `${baseTitle}${yearSuffix}${episodeSuffix}`;
}

function officialReleaseTitle(stream: any, mediaLabel: string): string {
  const lines = [stream.title, stream.name, stream.description]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .flatMap(value => value.split(/\r?\n/))
    .map(cleanOfficialLine)
    .filter(Boolean);

  const scored = lines.map(line => {
    let score = line.length;
    if (/\b(?:2160p|1080p|720p|480p|4k)\b/i.test(line)) score += 80;
    if (/\bS\d{1,2}[\s._-]*E\d{1,3}\b/i.test(line) || /\b\d{1,2}x\d{1,3}\b/i.test(line)) score += 80;
    if (/\b(?:web-?dl|webrip|blu-?ray|remux|hdtv|x26[45]|h26[45]|hevc|avc|av1)\b/i.test(line)) score += 50;
    if (/^(?:unk|unknown|sd|hd|4k)$/i.test(line)) score -= 100;
    return { line, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const line = scored[0]?.line || "Deepbrid Official";
  const normalizedLine = normalizeComparableTitle(line);
  const normalizedMedia = normalizeComparableTitle(mediaLabel.replace(/\s*S\d{2}E\d{2}$/i, ""));
  if (normalizedMedia && !normalizedLine.includes(normalizedMedia)) {
    return `${mediaLabel} - ${line}`;
  }
  return line;
}

function officialSizeBytes(stream: any, parsedSize?: number): number | undefined {
  const raw = stream.sizeBytes || stream.size || stream.filesize || stream.fileSize || parsedSize;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function getOfficialDeepbridSources(
  client: DeepbridClient,
  media: MediaRequest,
  userConfig?: any
): Promise<SourceCandidate[]> {
  try {
    const streams = await client.getOfficialStremioStreams(media);
    const mediaLabel = await getMediaDisplayLabel(media);
    
    const candidates = streams.map((stream, index) => {
      const title = officialReleaseTitle(stream, mediaLabel);
      const rawText = [stream.title, stream.name, stream.description, title].filter(Boolean).join(" ");
      const parsed = parseRelease(rawText);
      const match = scoreReleaseMatch(rawText, media, parsed);
      
      return {
        id: nanoid(),
        mediaType: media.type,
        imdbId: media.imdbId,
        season: media.season,
        episode: media.episode,
        mediaKey: makeMediaKey(media),
        origin: "deepbrid-official",
        title,
        displayName: "Deepbrid Official",
        status: "ready",
        playableUrl: stream.url,
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
        sizeBytes: officialSizeBytes(stream, parsed.sizeBytes),
        matchScore: match.score,
        matchReason: match.reason,
        score: 10000 + match.score - index,
        createdAt: new Date().toISOString()
      };
    });

    const resolutionGroups: { [key: string]: any[] } = {
      "2160p": [],
      "1080p": [],
      "720p": [],
      "SD": [],
      "unknown": []
    };

    for (const cand of candidates) {
        if (cand.resolution === "2160p") resolutionGroups["2160p"].push(cand);
        else if (cand.resolution === "1080p") resolutionGroups["1080p"].push(cand);
        else if (cand.resolution === "720p") resolutionGroups["720p"].push(cand);
        else if (cand.resolution === "unknown") resolutionGroups["unknown"].push(cand);
        else resolutionGroups["SD"].push(cand);
    }

    let limitedCandidates: SourceCandidate[] = [];
    for (const res of ["2160p", "1080p", "720p", "SD", "unknown"]) {
        const group = resolutionGroups[res];
        // If unknown, map it to SD limits as fallback if not set? No, just give it 15.
        // Actually, Stremio users probably want all unknowns or limit to SD. Let's map unknown to SD for limits.
        const limitRes = res === "unknown" ? "SD" : res;
        let limit: number | "all" = 15;
        
        if (userConfig && userConfig.limits && userConfig.limits[limitRes as keyof typeof userConfig.limits] !== undefined) {
            limit = userConfig.limits[limitRes as keyof typeof userConfig.limits];
        }

        if (limit === "all") {
            limitedCandidates = limitedCandidates.concat(group);
        } else {
            limitedCandidates = limitedCandidates.concat(group.slice(0, Number(limit)));
        }
    }

    return limitedCandidates as SourceCandidate[];
  } catch (err) {
    console.error("Failed to fetch official streams", err);
    return [];
  }
}
