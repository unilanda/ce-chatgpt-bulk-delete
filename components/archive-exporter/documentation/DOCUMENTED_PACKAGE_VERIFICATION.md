# Documented Package Verification

The documented v1.4.0 packages add:
- `HANDOFF.md`
- `documentation/*.md`
- a README pointer to the developer documentation

They do **not** modify runtime JavaScript, CSS, HTML, manifests, or icons.

Runtime files were SHA256-compared against the previously validated stable v1.4.0 source trees and matched byte-for-byte for both Chrome and Firefox.

This deliberate choice avoids turning documentation work into an untested functional release.
