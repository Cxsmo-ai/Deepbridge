import assert from "node:assert/strict";
import { parseNexusSearchResults } from "../dist/nexus/miatrix.js";

const html = `
<table>
  <tbody>
    <tr>
      <td><a href="/details/abc123">Titanic.1997.2160p.UHD.BluRay.REMUX.DV.HDR10.TrueHD.7.1-GROUP</a></td>
      <td>Remux</td>
      <td>HEVC</td>
      <td>TrueHD 7.1</td>
      <td>Movies UHD</td>
      <td>78.4 GB</td>
      <td>2026-06-01</td>
      <td><a href="/getnzb/nzb456">Download</a> Grabs: 42</td>
    </tr>
    <tr>
      <td><a href="/details/def789">Your.Friends.And.Neighbors.S02E03.1080p.WEB-DL.x265-GROUP</a></td>
      <td>WEB-DL</td>
      <td>x265</td>
      <td>DDP5.1</td>
      <td>TV HD</td>
      <td>2.1 GB</td>
      <td>2026-06-02</td>
      <td><a href="/getnzb/nzb999">Download</a></td>
    </tr>
  </tbody>
</table>`;

const results = parseNexusSearchResults(html);
assert.equal(results.length, 2);
assert.equal(results[0].releaseHash, "abc123");
assert.equal(results[0].nzbHash, "nzb456");
assert.equal(results[0].title, "Titanic.1997.2160p.UHD.BluRay.REMUX.DV.HDR10.TrueHD.7.1-GROUP");
assert.equal(results[0].sizeBytes, Math.round(78.4 * 1073741824));
assert.equal(results[0].grabs, 42);
assert.equal(results[1].releaseHash, "def789");
assert.equal(results[1].nzbHash, "nzb999");

console.log("Nexus/Miatrix parser test passed");
