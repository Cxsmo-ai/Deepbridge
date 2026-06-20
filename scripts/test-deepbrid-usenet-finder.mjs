import assert from "node:assert/strict";
import { __deepbridUsenetFinderTest } from "../dist/deepbrid/usenetFinder.js";

const { parseFinderResults, deepFindFiles, selectBestVideo, mergeCookieStrings, hasCloudflareChallenge, parseBrowserHeaders } = __deepbridUsenetFinderTest;

const html = JSON.stringify({
  results: [{
    token: "abc123",
    title: "Example.Show.S01E02.1080p.WEB-DL.H264-GRP",
    cat: "TV > HD",
    sizeBytes: 1610612736
  }]
});

const media = { type: "series", imdbId: "tt1234567", season: 1, episode: 2 };
const metadata = { title: "Example Show", aliases: ["Example Show"], year: 2026 };
const results = parseFinderResults(html, media, metadata);
assert.equal(results.length, 1);
assert.equal(results[0].token, "abc123");
assert.equal(results[0].category, "TV > HD");
assert.equal(results[0].sizeBytes, 1610612736);

const files = deepFindFiles({
  files: [
    { name: "Example.Show.S01E02.1080p.WEB-DL.H264-GRP.par2", url: "https://usenet.example/0.par2", size: 1024 },
    { name: "Example.Show.S01E02.1080p.WEB-DL.H264-GRP.mkv", url: "https://usenet.example/1.mkv", size: 1234 },
    { name: "Example.Show.S01E03.1080p.WEB-DL.H264-GRP.mkv", url: "https://usenet.example/2.mkv", size: 9999 }
  ]
});
const selected = selectBestVideo(files, media);
assert.equal(selected.name, "Example.Show.S01E02.1080p.WEB-DL.H264-GRP.mkv");

assert.equal(
  mergeCookieStrings("PHPSESSID=session1; amember_nr=member1", [
    { name: "cf_clearance", value: "clearance1" },
    { name: "PHPSESSID", value: "session1" }
  ]),
  "PHPSESSID=session1; amember_nr=member1; cf_clearance=clearance1"
);
assert.equal(hasCloudflareChallenge("<title>Just a moment...</title>", 403), true);
assert.equal(hasCloudflareChallenge("generic forbidden response", 403), true);
assert.equal(hasCloudflareChallenge("<table><tr data-token=\"x\"></tr></table>", 200), false);

assert.deepEqual(
  parseBrowserHeaders({
    "User-Agent": "Edge UA",
    "Accept-Language": "en-US,en;q=0.9",
    DNT: "1",
    Cookie: "secret",
    Host: "www.deepbrid.com",
    Priority: "u=1, i",
    "Sec-CH-UA-Arch": "\"x86\"",
    "Sec-CH-UA-Full-Version": "\"149.0.4022.69\"",
    "Sec-CH-UA-Platform": "\"Windows\""
  }),
  {
    "user-agent": "Edge UA",
    "accept-language": "en-US,en;q=0.9",
    dnt: "1",
    priority: "u=1, i",
    "sec-ch-ua-arch": "\"x86\"",
    "sec-ch-ua-full-version": "\"149.0.4022.69\"",
    "sec-ch-ua-platform": "\"Windows\""
  }
);

console.log("Deepbrid Usenet Finder parser tests passed");
