---
version: "1.10.0"
mcp_prompt: webStudio
last_synced: "2026-09-08"
title: "Fusebase Gate Web Studio Operations"
category: specialized
---
# Fusebase Gate Web Studio Operations

> **MARKER**: `mcp-web-studio-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `webStudio` for latest content.

---
## Table of contents

- [Fusebase Gate Web Studio Operations](#fusebase-gate-web-studio-operations)
- [Read this before anything else](#read-this-before-anything-else)
- [Design taste](#design-taste)
- [Relevant Operations](#relevant-operations)
- [Publishing](#publishing)
- [Look at what you made](#look-at-what-you-made)
- [Pointing a person at Studio itself](#pointing-a-person-at-studio-itself)
- [Choosing an edit operation](#choosing-an-edit-operation)
- [Grouping edits](#grouping-edits)
- [The sequence that works](#the-sequence-that-works)
- [Rules no single operation can state](#rules-no-single-operation-can-state)
- [Working Rules](#working-rules)

---
## Fusebase Gate Web Studio Operations

These operations manage **Web Studio sites**, which are a different
product from portals and share almost none of their vocabulary.

## Read this before anything else

**A Web Studio site is HTML and CSS that the site owns.** It is not a
tree of typed blocks. There is no `addWebStudioHeadingBlock`, no block
picker, and no settings object per block. Editing a page means editing
the file that page renders.

If you have read the `portals` prompt, set it aside here. Reaching for
the nearest portal-shaped operation and writing a block tree into an
HTML file is the single most likely way to get this wrong.

Structured data does exist alongside the markup, and it is small and
deliberate: the route table (pages), menus, access rules, theme tokens
and named palettes. Everything else is a file.

## Design taste

Editing markup and CSS here is a design act, not just a text edit.
This surface has no built-in design lead watching the result the way a
person does in Studio Chat, so the rules below are the substitute.
They apply whenever a call creates a page, rewrites a section, or
changes layout, typography, color, or spacing — not to a pure copy fix
or a one-line CSS tweak.

**Read the brief in one line before writing markup**: page kind,
audience, vibe, and the aesthetic family this leans toward. If genuinely
ambiguous, ask one question; otherwise commit and proceed rather than
defaulting to the nearest generic template.

**Anti-default discipline.** Do not reach for: a centered hero over a
gradient blob, three equal feature cards in a row, purple/violet
"AI" gradients and glows, nested cards for everything, or decorative
hero art with no real content behind it. For premium / artisan /
hospitality briefs specifically: warm cream plus terracotta-or-ochre
plus espresso ink is the single most repeated AI palette — rotate
through cold-luxury silver/chrome, deep forest plus bone, off-black plus
warm tan, cobalt plus cream, terracotta plus slate, olive plus brick, or
monochrome plus one saturated accent instead, and do not repeat the same
family as the last site this session touched. One accent hue per
project, used identically everywhere.

**Hard bans — check mechanically before saying a change is done:**
- No em dash (—) anywhere visible: headings, eyebrows, buttons, quotes,
  captions, alt text. Use a period, comma, or hyphen.
- No section-number or version eyebrows ("01 / Capabilities", "v0.6",
  "BETA", "Stage 1 / Stage 2 / Stage 3"). Name the topic in plain
  language, or drop the eyebrow.
- At most one small-uppercase eyebrow label per three sections, hero
  included. A 6-section page gets at most 2.
- No three-equal-card row as the default shape for a feature or benefit
  section — vary composition (2-up, asymmetric split, full-width band).
- No more than two consecutive sections sharing one layout family; the
  third repeat must break the pattern.
- No "big headline on one side, small explainer paragraph floating on
  the other" as a section header — stack vertically, or give the second
  column real content instead of filler prose.
- Hero fits without scrolling to the primary action: headline at most 2
  lines, supporting copy roughly 20 words or fewer, primary action
  visible on load, at most 4 text elements total (eyebrow, headline, one
  supporting line, up to 2 CTAs).
- No duplicate call-to-action intent under different wording ("Get in
  touch" / "Contact us" / "Let's talk" all mean the same thing) — one
  label per intent, reused exactly.
- Every button and tinted surface is checked for contrast against its
  own background specifically, not the page background.
- One corner-radius system and one accent color for the whole page.
- Quotes and testimonials: 2 to 3 lines of body at most, attributed with
  a name and role.
- No decorative colored dots, hairline crosshair grids, or locale/
  time-zone strips added purely for texture.

**Layout pitfalls — the defects generated pages actually ship.** These
are write-time rules; nothing renders the page to catch them later.
- No fixed height on anything holding text, and no `px` width on a
  content container. Use `max-width` with `width: 100%` and let height
  come from content.
- Flex and grid children do not shrink by default. A child that can
  hold a long heading, URL, table, or `<pre>` needs `min-width: 0` in a
  flex row, or `minmax(0, 1fr)` in a grid track, or the row grows past
  the viewport and the page scrolls sideways.
- Every multi-column row states how it stacks. Prefer
  `grid-template-columns: repeat(auto-fit, minmax(<floor>, 1fr))` so it
  collapses with no media query; otherwise write the media query.
- Never `100vw` — it ignores the scrollbar and overflows. Use `100%`.
- Images: `max-width: 100%; height: auto;` plus `width`/`height`
  attributes or `aspect-ratio`, so the page does not jump on load.
  `object-fit: cover` only when a fixed frame is deliberate; it crops.
- Long unbroken strings (URLs, emails, ids, compound words) need
  `overflow-wrap: anywhere`. No `overflow: hidden` on a text container
  without an explicit clamp.
- Sticky and fixed elements reserve their own space and must not cover
  the primary action at 375px. Absolute positioning is for decoration
  inside a container that already reserves the room.
- Tap targets at least 44x44px with real spacing between adjacent
  links, and never `user-scalable=no` or `maximum-scale=1`.
- An `<fb-embed>` must not sit in a fixed-height box; it negotiates its
  own height after it loads.

Check the widest things first: tables, code blocks, long headings, nav
rows, button rows, and card grids.

**Content pitfalls.**
- Nothing placeholder ships: no lorem ipsum, "[Your Company]", "TODO",
  or bracketed slots. If a value is genuinely unknown, write plausible
  generic copy and name in your reply the lines the owner must replace.
- Do not fabricate verifiable specifics: phone numbers, addresses,
  prices, dates, headcounts, certifications, award claims, or a
  testimonial attributed to an invented named person at a
  real-sounding company. An obvious placeholder is honest; a realistic
  fake is not.
- Every internal `href` points at a route the site actually has, and
  nav labels match the titles of the pages they open.
- Each page gets its own title and description, not a copy of the home
  page's.

**Editing an existing site is a redesign, not a rebuild.** Read the
current pages first and note the site's own accent, type choice,
radius, and copy voice — that is the baseline, not a default to
overwrite. Preserve routes, primary nav labels, and existing copy voice
unless asked to change them. Order changes by value against risk:
typography and spacing first, then color recalibration that keeps the
existing accent, then hero/section recomposition, and only replace a
section's structure entirely when it is not salvageable within the
current system. Never silently change route slugs, nav labels, form
field names, or the site's logo — those need an explicit ask.

**Imagery.** CSP on a site is `img-src 'self' data:` — no external URL,
stock site, or CDN reference will ever render, and there is no
server-side fetch tool reachable from here. A real photo can come from a
file the calling application already has and passes through as page
content, or from **generateWebStudioImage** where the caller holds
`sites.image.create` — most tokens do not, since it is a real paid call
per invocation and is granted separately from `sites.write`. A 400 from
it means image generation is not configured or not permitted in this
environment; do not invent an image URL or a plausible-looking `data:`
payload as a substitute. Prefer typography, layout, and SVG for
anything that is not backed by a real asset or a successful
generateWebStudioImage call.

## Relevant Operations

Read:
- listWebStudioSites: sites in the organization the caller may open, each with the `branchId` every other operation needs.
- getWebStudioSiteContext: the whole shape in one call — routes depth-first with access and source file, menus with their settings, palettes by name, a file inventory with sizes, recent changesets, and how far the published site is behind the draft.
- readWebStudioFile: the exact current text of one HTML or CSS file, including its `data-fb-id` attributes.

Start a site:
- listWebStudioTemplates: the catalog `createWebStudioSite` accepts as `templateKey`, each with a page count and a gallery description. Call this before naming a template — an unrecognized key does not error, it falls back silently to the demo project, so a guessed key produces the wrong site with no warning.
- createWebStudioSite: a new site, owned by the caller, in the organization named by `orgId` — never a default picked for you. Omit `templateKey` for the platform's demo project, or pass "blank" for an empty single page site, or a key from `listWebStudioTemplates`.

Edit the draft (none of these publish anything):
- Markup and styles: writeWebStudioFile, patchWebStudioFile, patchWebStudioBlock, insertWebStudioHtml.
- Routes: createWebStudioPage, updateWebStudioPage, deleteWebStudioPage, setWebStudioPageAccess, setWebStudioPageSeo.
- Navigation: addWebStudioMenu, updateWebStudioMenu.
- Look: setWebStudioTheme, addWebStudioPalette, setWebStudioStyleSets.
- The site itself: setWebStudioSiteIdentity.
- applyWebStudioEdits: several of the above as one change.

Generate imagery (a real paid call, its own permission, not part of
applyWebStudioEdits):
- generateWebStudioImage: a new photo or illustration from a text prompt, placed as a `data:` URI. Requires `sites.image.create`; a 400 means it is not configured or not granted here.

History and looking at the result:
- moveWebStudioCursor: undo or redo, optionally straight to a `seq` from the history.
- createWebStudioPreviewLink: a link you can open to see how the draft actually renders.

Release — the only operations the public sees:
- listWebStudioReleases: every release, newest first, with the one currently served marked.
- publishWebStudioSite: cut a release from the draft and serve it.
- rollbackWebStudioSite: serve an earlier release again.

## Publishing

**Publish when a person asks you to, not when the work looks done.**
Everything else on this surface is recoverable by somebody who notices
it. This one is seen by whoever visits the site in the meantime, so
finishing a task is not consent to release it. Say the draft is ready
and let them decide, unless they already told you to publish.

`expectedVersion` is required here and optional everywhere else. Pass
the version you last read, so what goes public is what you looked at
rather than whatever the draft holds by the time the call lands.

Publish re-checks the whole project and refuses a release that would
expose a page behind sign-in, or leave a link pointing at a page that
no longer exists. The refusal names what to fix — fix it and publish
again rather than looking for a way around the check. Warnings come
back in `diagnostics`: repeat them to the person, do not act on them
alone.

If a publish turns out wrong, **rollbackWebStudioSite** is the fast way
out. It changes only which release visitors are served — nothing is
deleted and the draft does not move — so use it to stop the bleeding
first and fix the draft afterwards. The release to name is the one
listWebStudioReleases marks `current`, minus whatever went wrong; the
newest release is not always the current one, which is exactly what a
previous rollback leaves behind.

## Look at what you made

If you can open a URL, do. **createWebStudioPreviewLink** returns a
link that renders the draft the way a visitor would see it — layout,
stylesheet, menus and all — which is not something you can work out
reliably by reading the source. After a visual change, open it, look,
and fix what is wrong before saying you are done.

That link is a credential. It needs no sign-in and it shows
unpublished work, so it expires in minutes by design. Do not paste it
into anything that outlives the task, and do not offer it as a way to
share the site — the site is shared by publishing it.

## Pointing a person at Studio itself

A question about the editor, not the site — "how do I add a custom
domain", "where do I see AI usage", "how do I edit the raw HTML" —
is answered with a link into Studio, not a description of menus to
click through. `getWebStudioSiteContext`'s `publish.studioUrl` names
this site and branch already; append `&goto=<id>` to land on one
section instead of the site list. Ids that exist today:
`settings.site` (name and defaults), `settings.address` (custom
domain / CNAME — NOT "who can see this", despite the similar
spelling to "access"), `settings.sharing` (who can enter, invite
links), `settings.pages` (per-page access rules), `settings.menus` (navigation), `settings.groups`
(audiences for gated pages), `settings.seo` (search visibility),
`settings.usage` (AI token usage and cost), `components` (the block
library), `page` (the current page's own settings), `files` (raw
HTML/CSS source), `styles` (theme tokens and palettes), `history`
(past changesets and undo). This list is short on purpose and lives
in `DEEP_LINKS` in sites-codex's
apps/studio/src/App.tsx — never invent an id that is not in it. Check
that the id actually matches what you are telling the person, not
just that it exists — a color palette or theme question is
`styles`, never `settings.address`; an id that contradicts the rest
of the answer is worse than no link. The link text is human words
describing the destination ("Styles", "Settings → Sharing"),
never the id itself.

Also never fall back to describing a generic "Account settings" or
"Billing" menu: Studio has no such section, and a caller with no
screen has no way to check that guess before handing it over. If
the place someone is asking about has no id yet, link to bare
`studioUrl` (the site itself) and say plainly that you don't have a
direct link to that one section — that is a better answer than a
plausible-sounding path that is wrong.

`studioUrl` is absent when the environment has not configured a
Studio origin. Do not construct one by guessing a hostname.

## Choosing an edit operation

For anything in HTML that carries a `data-fb-id`, use
**patchWebStudioBlock**. The element keeps its id and nothing around it
has to be reproduced.

To add something while leaving an existing element alone, use
**insertWebStudioHtml**. Do not re-emit a neighbouring element inside a
replacement just to keep it — that is how a block silently loses its id
or an attribute nobody meant to touch.

For text with no id to aim at, such as a CSS rule, use
**patchWebStudioFile**, with `expectedText` copied verbatim from a fresh
readWebStudioFile. Text typed from memory does not match and the patch
is refused.

Use **writeWebStudioFile** for a new file, or when you are genuinely
replacing all of one. Rewriting a whole file to change one rule means
reproducing the rest of it correctly, and losing anything a person
changed since you read it.

## Grouping edits

**applyWebStudioEdits** applies a list in order as one entry in the
history, and either all of them land or none do. Use it when the edits
are one change to the person who asked: a stylesheet rule and the markup
that uses it, or a new page and the menu it belongs in. A later edit in
the list sees the effect of the earlier ones.

Prefer the single-purpose operations when the edits are unrelated —
their arguments are typed and checked, and the batch's are not. Each
entry's `name` is the underlying vocabulary: write_file, apply_patch,
patch_by_id, insert_html, create_page, update_page, delete_page,
set_page_access, set_page_seo, add_menu, update_menu, set_theme,
add_palette, set_style_sets, set_site_identity.

## The sequence that works

1. `listWebStudioSites` — a request naming a site by title has to be
   resolved to an id first. Do not guess an id.
2. `getWebStudioSiteContext` — one call, not four. It is what replaces
   the screen a human editor is looking at.
3. `readWebStudioFile` — before changing anything in a file. A patch
   built from memory of what a page probably says does not apply.
4. Edit, then say what you changed. Check `getWebStudioSiteContext`
   again if a later edit depends on the shape you just altered.

## Rules no single operation can state

- **There is no current page and no selection.** Every operation names
  its site and its branch. Nothing is remembered between calls, and
  that is deliberate: a remembered 'current page' is how an agent edits
  the wrong thing when two conversations interleave.
- **Elements are addressed by `data-fb-id`.** That attribute in the
  markup is the stable handle — the same one the built-in editor uses
  when a person clicks something. Get it from readWebStudioFile.
- **Structure is stated once, in the page tree.** A page nested under
  another is what produces a submenu. Menus are generated from that
  tree with a `depth` setting; navigation links written by hand into a
  layout stop following the pages and go stale.
- **Nothing is live until it is published.** Every edit lands in the
  draft. `changesAhead` in the site context says how far the public
  site is behind it. Publishing is what moves it, and it is the one
  operation here a mistake makes public.
- **Undo is cheap; treat it as the way back.** moveWebStudioCursor
  walks the journal rather than deleting anything, and an undone
  changeset stays redoable until something new lands on top of it. If
  an edit went wrong, undo it rather than patching over it — a patch
  that repairs a mistake leaves two entries in the history where the
  person reading it expects none.
- **Concurrency is explicit.** Pass the `expectedVersion` you read from
  getWebStudioSiteContext, and use the `version` each edit returns for
  the next one. A 409 means somebody else moved the draft — a person
  with the studio open, most likely. Re-read and rebuild the edit; do
  not retry it unchanged, and do not drop the version to force it
  through.
- **A refused edit is a message worth reading.** "Patch context was not
  found in styles/site.css" means your `expectedText` is stale, not
  that the operation is broken. Re-read the file.
- **Theme tokens before CSS.** Colors, radius and fonts live in the
  theme and in named palettes, which every template already reads.
  Writing color declarations or `html[data-fb-theme]` rules into a
  stylesheet makes a site that the palette picker no longer controls.
- **Never add scripts.** No `<script>`, no inline event handlers, no
  iframes, no `javascript:` URLs, no CSS `@import` or external
  stylesheet URLs. These are refused, and working around the refusal is
  not the task.
- **A preview URL is authenticated.** It shows unpublished work. It is
  not a link to paste anywhere that outlives the conversation.

## Working Rules

- Use tools_describe before calling an operation whose input you are unsure of, rather than guessing a field name.
- A site the caller is not a member of answers 404, not 403. Treat it as absent; do not retry with a different id to probe.
- Report what you changed in terms of routes and files, not blocks. The person reading your summary can open the file you name.
---

## Version

- **Version**: 1.10.0
- **Category**: specialized
- **Last synced**: 2026-09-08
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
