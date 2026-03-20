import { DOTFace, DOT_SIZE, DotType, DotType as DotType$1, DotType as DotType$2, PAYLOAD_SIZE, activeFaces, checkChain, createDOT, createKeypair, fromBytes, toBytes, verifyDOT } from "@dotprotocol/core";
//#region src/hash.ts
/**
* @dotprotocol/sign — Hashing utilities
*
* SHA-256 content hashing and truncation for DOT payloads.
*/
/** Compute full SHA-256 hash of content */
async function contentHash(content) {
	const hash = await crypto.subtle.digest("SHA-256", content);
	return new Uint8Array(hash);
}
/** Compute truncated SHA-256 hash (first 16 bytes) for DOT payload */
async function truncatedHash(content) {
	return (await contentHash(content)).slice(0, PAYLOAD_SIZE);
}
//#endregion
//#region src/types.ts
/** TEACH byte values — self-describing DOTs */
let TeachByte = /* @__PURE__ */ function(TeachByte) {
	TeachByte[TeachByte["None"] = 0] = "None";
	TeachByte[TeachByte["SelfDescribing"] = 1] = "SelfDescribing";
	TeachByte[TeachByte["SchemaRef"] = 2] = "SchemaRef";
	TeachByte[TeachByte["HumanReadable"] = 3] = "HumanReadable";
	TeachByte[TeachByte["MachineReadable"] = 4] = "MachineReadable";
	return TeachByte;
}({});
//#endregion
//#region src/sign.ts
/**
* @dotprotocol/sign — sign()
*
* Universal signing. Content is opaque. Any size.
* If content <= 16 bytes, stored directly in payload.
* If content > 16 bytes, truncated SHA-256 hash stored in payload.
*/
const enc = new TextEncoder();
async function sign(input) {
	const { key, access, face = 0, teach = TeachByte.None, transform, ts } = input;
	let contentBytes;
	if (input.content !== void 0) contentBytes = typeof input.content === "string" ? enc.encode(input.content) : input.content;
	let payload;
	let cHash;
	if (contentBytes !== void 0) if (contentBytes.length <= PAYLOAD_SIZE) payload = contentBytes;
	else {
		cHash = await contentHash(contentBytes);
		payload = await truncatedHash(contentBytes);
	}
	let previous;
	if (input.prev) previous = input.prev;
	const dot = await createDOT({
		keypair: key,
		payload,
		type: access,
		previous,
		ts
	});
	if (face !== 0) dot.faceMask = face;
	const bytes = toBytes(dot);
	return {
		dot,
		bytes,
		hash: new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
		face,
		teach,
		transform,
		contentHash: cHash
	};
}
//#endregion
//#region src/verify.ts
/**
* @dotprotocol/sign — verify()
*
* Verify a DOT's signature. < 1ms. No handshake. No CA.
*/
/** Verify a SignedDOT, a DOT object, or raw 153 bytes */
async function verify(input) {
	if (input instanceof Uint8Array) return verifyDOT(fromBytes(input));
	if ("dot" in input && "bytes" in input) return verifyDOT(input.dot);
	return verifyDOT(input);
}
//#endregion
//#region src/chain.ts
/**
* @dotprotocol/sign — chain()
*
* Chain integrity verification and extension.
*/
/** Verify chain integrity for an array of DOTs (any supported format) */
async function chain(dots) {
	const resolved = dots.map((d) => {
		if (d instanceof Uint8Array) return fromBytes(d);
		if ("dot" in d && "bytes" in d) return d.dot;
		return d;
	});
	const result = await checkChain(resolved);
	if (result.valid) return {
		valid: true,
		length: resolved.length
	};
	return {
		valid: false,
		length: resolved.length,
		brokenAt: result.brokenAt,
		reason: result.reason
	};
}
//#endregion
//#region src/describe.ts
/**
* @dotprotocol/sign — describe()
*
* Human-readable user manual for any DOT.
* Every DOT is self-describing (Correction #47).
*/
function bytesToHex(b) {
	return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
const ACCESS_NAMES = {
	[DotType$2.PUBLIC]: "public",
	[DotType$2.CIRCLE]: "circle",
	[DotType$2.PRIVATE]: "private",
	[DotType$2.EPHEMERAL]: "ephemeral"
};
const TEACH_NAMES = {
	[TeachByte.None]: "none",
	[TeachByte.SelfDescribing]: "self-describing",
	[TeachByte.SchemaRef]: "schema-ref",
	[TeachByte.HumanReadable]: "human-readable",
	[TeachByte.MachineReadable]: "machine-readable"
};
/** Produce a human-readable description of a DOT */
function describe(input) {
	let dot;
	let face = 0;
	let teach = TeachByte.None;
	if (input instanceof Uint8Array) dot = fromBytes(input);
	else if ("dot" in input && "bytes" in input) {
		const signed = input;
		dot = signed.dot;
		face = signed.face;
		teach = signed.teach;
	} else {
		dot = input;
		face = dot.faceMask ?? 0;
	}
	const isGenesis = dot.chain.every((b) => b === 0);
	const isPing = dot.payload.every((b) => b === 0);
	return {
		key: bytesToHex(dot.pubkey),
		chain: bytesToHex(dot.chain),
		time: new Date(dot.ts).toISOString(),
		ts: dot.ts,
		access: ACCESS_NAMES[dot.type] ?? `unknown(0x${dot.type.toString(16)})`,
		payload: bytesToHex(dot.payload),
		faces: face !== 0 ? activeFaces(face) : [],
		teach: TEACH_NAMES[teach] ?? `unknown(0x${teach.toString(16)})`,
		isGenesis,
		isPing,
		size: DOT_SIZE
	};
}
//#endregion
export { DotType as AccessLevel, DotType$1 as DotType, DOTFace as Face, TeachByte, chain, contentHash, createKeypair, describe, sign, truncatedHash, verify };

//# sourceMappingURL=index.js.map