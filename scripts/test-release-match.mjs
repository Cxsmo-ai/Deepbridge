import assert from "node:assert/strict";
import { normalizeComparableTitle, scoreReleaseMatch } from "../dist/core/releaseMatch.js";
import { parseRelease } from "../dist/core/parseRelease.js";

const seriesCases = [
  ["Schitt's Creek", "Schitts.Creek.S01E01.1080p.WEB-DL.x264-GROUP", 1, 1],
  ["Bob's Burgers", "Bobs.Burgers.S14E03.1080p.WEB.h264-GROUP", 14, 3],
  ["Grey's Anatomy", "Greys.Anatomy.S20E01.720p.HDTV.x264-GROUP", 20, 1],
  ["It's Always Sunny in Philadelphia", "Its.Always.Sunny.in.Philadelphia.S16E08.1080p.WEB-DL.x265-GROUP", 16, 8],
  ["Marvel's Agents of S.H.I.E.L.D.", "Marvels.Agents.of.S.H.I.E.L.D.S03E12.1080p.WEBRip.x264-GROUP", 3, 12],
  ["Law & Order: Special Victims Unit", "Law.and.Order.Special.Victims.Unit.S25E02.1080p.WEB.h264-GROUP", 25, 2],
  ["NCIS: Los Angeles", "NCIS.Los.Angeles.S10E04.720p.HDTV.x264-GROUP", 10, 4],
  ["9-1-1", "9-1-1.S07E05.1080p.WEB.h264-GROUP", 7, 5],
  ["The Good Place", "The.Good.Place.S02E06.1080p.WEB-DL.x264-GROUP", 2, 6],
  ["Only Murders in the Building", "Only.Murders.in.the.Building.S03E04.1080p.WEB.h264-GROUP", 3, 4],
  ["What We Do in the Shadows", "What.We.Do.in.the.Shadows.S05E09.1080p.WEB-DL.x265-GROUP", 5, 9],
  ["Star Trek: Strange New Worlds", "Star.Trek.Strange.New.Worlds.S02E01.2160p.WEB-DL.x265-GROUP", 2, 1],
  ["Curb Your Enthusiasm", "Curb.Your.Enthusiasm.11x07.1080p.WEB.h264-GROUP", 11, 7],
  ["Dragon Ball Z", "Dragon.Ball.Z.028.1080p.BluRay.x264-GROUP", undefined, 28, { isAnime: true }],
  ["Naruto", "Naruto.005.720p.WEB-DL.x264-GROUP", undefined, 5, { isAnime: true }]
];

const movieCases = [
  ["Spider-Man: Into the Spider-Verse", "Spider-Man.Into.the.Spider-Verse.2018.1080p.BluRay.x264-GROUP", 2018],
  ["Everything Everywhere All at Once", "Everything.Everywhere.All.At.Once.2022.2160p.WEB-DL.x265-GROUP", 2022],
  ["Wall-E", "WALL-E.2008.1080p.BluRay.x264-GROUP", 2008],
  ["Se7en", "Se7en.1995.1080p.BluRay.x264-GROUP", 1995],
  ["Mission: Impossible - Dead Reckoning Part One", "Mission.Impossible.Dead.Reckoning.Part.One.2023.2160p.WEB-DL.x265-GROUP", 2023],
  ["Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb", "Dr.Strangelove.or.How.I.Learned.to.Stop.Worrying.and.Love.the.Bomb.1964.1080p.BluRay.x264-GROUP", 1964],
  ["Harry Potter and the Sorcerer's Stone", "Harry.Potter.and.the.Sorcerers.Stone.2001.1080p.BluRay.x264-GROUP", 2001],
  ["Ocean's Eleven", "Oceans.Eleven.2001.1080p.BluRay.x264-GROUP", 2001],
  ["M*A*S*H", "MASH.1970.1080p.BluRay.x264-GROUP", 1970],
  ["No Country for Old Men", "No.Country.for.Old.Men.2007.1080p.BluRay.x264-GROUP", 2007]
];

for (const [title, releaseTitle, season, episode, extraMetadata = {}] of seriesCases) {
  const media = { type: "series", imdbId: `tt-test-${title}`, season, episode };
  const metadata = {
    title,
    aliases: [title, `${title} ${extraMetadata.isAnime ? 1999 : 2020}`],
    year: extraMetadata.isAnime ? 1999 : 2020,
    ...extraMetadata
  };
  const parsed = parseRelease(releaseTitle);
  const match = scoreReleaseMatch(releaseTitle, media, parsed, metadata);

  assert.ok(
    match.score >= 650,
    `expected series match for ${title}; got ${match.score} (${match.reason}) from ${releaseTitle}`
  );
  assert.doesNotMatch(match.reason, /\bweak-title\b/, `expected strong title evidence for ${title}`);
}

for (const [title, releaseTitle, year] of movieCases) {
  const media = { type: "movie", imdbId: `tt-test-${title}` };
  const metadata = { title, aliases: [title, `${title} ${year}`], year };
  const parsed = parseRelease(releaseTitle);
  const match = scoreReleaseMatch(releaseTitle, media, parsed, metadata);

  assert.ok(
    match.score >= 600,
    `expected movie match for ${title}; got ${match.score} (${match.reason}) from ${releaseTitle}`
  );
  assert.doesNotMatch(match.reason, /\bweak-title\b/, `expected strong title evidence for ${title}`);
}

assert.equal(normalizeComparableTitle("Schitt's Creek"), "schitts creek");
assert.equal(normalizeComparableTitle("Schitt\u2019s Creek"), "schitts creek");
assert.equal(normalizeComparableTitle("Law & Order: SVU"), "law and order svu");

console.log(`Release matching regression tests passed (${seriesCases.length} series, ${movieCases.length} movies)`);
