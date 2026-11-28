// Structural publication gate. A completed record is not a substitute for a
// maintainer's substantive review of legal, security and practical evidence.
export const CORE_VERSION = "0.12.10";
export const CORE_FIELDS = ["version", "registryIntegrity", "coreJsSha256", "coreWasmSha256"];
export const REVIEW_ITEMS = [
  "correspondingSource",
  "licenseAndDistribution",
  "codecPatents",
  "security",
  "cdnAndPrivacy",
  "thirdPartyNotices",
  "browserValidation",
];
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonblank(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function dateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
export function assertCoreLock(lock) {
  if (!record(lock) || lock.version !== CORE_VERSION ||
      typeof lock.registryIntegrity !== "string" ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(lock.registryIntegrity) ||
      typeof lock.coreJsSha256 !== "string" || !/^[a-f0-9]{64}$/.test(lock.coreJsSha256) ||
      typeof lock.coreWasmSha256 !== "string" || !/^[a-f0-9]{64}$/.test(lock.coreWasmSha256) ||
      typeof lock.approved !== "boolean" || !Object.hasOwn(lock,"review"))
    throw new Error("Invalid pinned core lock");
}
export function assertPublicationReview(lock) {
  assertCoreLock(lock);
  const blocked = reason => { throw new Error("Publication blocked: " + reason); };
  if (lock.approved !== true) blocked("maintainer approval is absent");
  const review = lock.review;
  if (!record(review) || review.schemaVersion !== 1 || !nonblank(review.reviewer) ||
      !dateOnly(review.reviewedOn) || !nonblank(review.decisionReference))
    blocked("structured review and explicit maintainer decision are required");
  if (!record(review.core) || CORE_FIELDS.some(key => review.core[key] !== lock[key]))
    blocked("review does not match the exact pinned core");
  if (!record(review.items)) blocked("review items are missing");
  for (const key of REVIEW_ITEMS) {
    const item = review.items[key];
    if (!record(item) || item.status !== "accepted" || !nonblank(item.evidence))
      blocked("unresolved review item: " + key);
  }
}
export function assertPublicationManifest(lock, manifest) {
  assertPublicationReview(lock);
  if (!record(manifest) || CORE_FIELDS.some(key => manifest[key] !== lock[key]))
    throw new Error("Publication blocked: built manifest does not match the reviewed core");
}
