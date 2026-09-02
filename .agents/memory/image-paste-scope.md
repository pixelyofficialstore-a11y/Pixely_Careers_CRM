---
name: Image paste scope
description: Image upload paste handling must cover clipboard events while surrounding forms or dialogs have focus.
---

For image uploaders inside forms or dialogs, listen for image clipboard events at document scope while the uploader is active; a sibling dropzone cannot receive paste events from a focused textarea or select.

**Why:** Clipboard paste events bubble through the focused control's DOM ancestors, not across to a separate uploader element.

**How to apply:** Intercept only clipboard payloads containing image files, preserve normal text pastes, and avoid registering both local and document handlers for the same uploader.