// Settings for coi-serviceworker.js, which reads `window.coi`. Loaded before it.
//
// The vendored script defaults to COEP "credentialless" outside Chrome, which
// Safari does not support. This site has no cross-origin subresources, so the
// universally supported "require-corp" is safe in every browser.
window.coi = { coepCredentialless: () => false };
