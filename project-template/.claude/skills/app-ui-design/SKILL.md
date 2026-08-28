---
name: app-ui-design
description: "Guidance for visual design, UI and UX in Fusebase-generated apps. Use when building or refining app UIs: pages, components, layouts, forms, feedback states, theming, or accessibility. Ensures consistent, clear, and distinctive interfaces using shadcn/ui.<% if (it.flags?.includes("site-embed-theme")) { %> Also covers theming an app framed by a FuseBase site (token utilities so the wrapper's palette lands).<% } %>"
---

# App UI Design

This skill guides UI/UX in **generated apps** (Fusebase Apps). Use **shadcn/ui** for all UI. Apply a clear design direction and avoid generic AI aesthetics.

---

## Design philosophy

**Clarity over decoration.** Every visual choice supports hierarchy and scannability. Prefer one bold aesthetic direction (minimal, warm, editorial, etc.) and execute it consistently.

- **Purpose first**: What does the screen do? Who uses it?
- **Tone**: Choose one direction (e.g. minimal, warm/SaaS, editorial, utilitarian) and stick to it.
- **Differentiation**: Avoid default "AI" look: no Inter/Roboto-only, no purple gradients on white, no same-as-everyone layouts. Vary fonts, palette, and density per context.

---

## Visual identity

### Tailwind CSS v4

Apps use **Tailwind CSS v4** (via `@tailwindcss/postcss`). Key differences from v3:

- **Import**: Use `@import "tailwindcss"` in `globals.css` (not `@tailwind base/components/utilities`).
- **No `tailwind.config.js`**: Configuration is CSS-first. Use `@theme` in CSS to define custom tokens.
- **Content detection is automatic**: Tailwind v4 scans project files automatically. If needed, use `@source "../path/**/*.tsx"` to add extra directories.

**⚠️ CRITICAL — CSS variables in arbitrary values:**

Do **NOT** define raw `:root` CSS variables and reference them via arbitrary value syntax. This is the most common Tailwind v4 pitfall:

```css
/* ❌ BROKEN — variables are NOT available to Tailwind's arbitrary value resolver */
:root {
  --card: #ffffff;
  --foreground: #0f172a;
}
```
```tsx
// ❌ BROKEN — these classes compile but resolve to empty/broken values
className="bg-[var(--card)] text-[var(--foreground)]"
```

**Instead, use one of these approaches:**

1. **Use Tailwind's built-in color palette** (preferred for most apps):
   ```tsx
   // ✅ Works — uses Tailwind's first-class utility classes
   className="bg-white text-slate-900 border-slate-200"
   className="text-indigo-500 bg-indigo-50"
   ```

2. **Register custom tokens via `@theme`** (only if you need custom colors):
   ```css
   @import "tailwindcss";
   @theme {
     --color-brand: #6366f1;
     --color-surface: #ffffff;
   }
   ```
   ```tsx
   // ✅ Works — registered via @theme
   className="bg-surface text-brand"
   ```

3. **Use `@apply` for reusable component classes** (buttons, inputs):
   ```css
   .btn-primary {
     @apply inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded-xl;
     background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
   }
   ```

4. **Use inline `style` only for truly dynamic values** (e.g. colors from API data):
   ```tsx
   // ✅ OK — color is runtime data, can't be a utility class
   style={{ color: product.categoryColor, backgroundColor: `${product.categoryColor}18` }}
   ```

### shadcn/ui (when used)

- shadcn/ui components live in `components/ui/` (copied into the project, not installed as a package). Import from `@/components/ui/...`.
- When shadcn/ui is set up, its CSS variables (`--background`, `--foreground`, etc.) are registered through its own theme system and work with utility classes like `bg-background`, `text-foreground`.
- Prefer **variant** and **size** props on shadcn/ui components (e.g. `<Button variant="outline" size="sm">`) over ad-hoc Tailwind color overrides.
- Use the `cn()` utility (from `@/lib/utils`) to merge Tailwind classes safely: `cn("base-class", conditionalClass)`.

**⚠️ CRITICAL — Do NOT add a global `*` CSS reset:**

Do **NOT** add `* { margin: 0; padding: 0; box-sizing: border-box; }` in `globals.css`. Tailwind v4's Preflight already applies proper resets. A manual `*` reset has equal specificity to Tailwind's utility classes and will override them when it appears later in the cascade, breaking padding (`p-4`, `p-5`, `px-6`, etc.) and margin utilities silently.

```css
/* ❌ BROKEN — overrides Tailwind utilities like p-5, m-4 */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
```

```css
/* ✅ CORRECT — Tailwind v4 Preflight handles resets automatically */
@import "tailwindcss";
/* No manual * reset needed */
```

### General Tailwind usage

- **Typography**: Use Tailwind's typography scale (`text-sm`, `text-base`, `text-lg`, `font-semibold`, etc.) and keep heading/body consistent throughout the app.
- **Radius**: Use consistent rounding from the theme (`rounded-md` for cards and inputs; `rounded-full` for pills/avatars).
- **Colors**: Choose ONE approach based on whether shadcn/ui theming is set up:
  - **With shadcn/ui**: Use its semantic tokens (`bg-background`, `text-foreground`, `bg-muted`, `text-muted-foreground`, `border`) — these are pre-registered and work out of the box.
  - **Without shadcn/ui**: Use Tailwind's built-in palette (`bg-white`, `text-slate-900`, `bg-slate-100`, `text-slate-500`, `border-slate-200`).
  - **Never mix**: Don't use `bg-background` in an app without shadcn/ui theming — it won't resolve. Reserve inline `style` for dynamic/computed colors only.

### Hierarchy

Establish clear text hierarchy using the same approach as Colors above:

| Level | With shadcn/ui | Without shadcn/ui |
|-------|----------------|-------------------|
| **Primary** (main content) | `text-foreground` | `text-slate-900 dark:text-slate-100` |
| **Secondary** (labels, metadata) | `text-muted-foreground` | `text-slate-500 dark:text-slate-400` |
| **Tertiary** (timestamps, hints) | Smaller size + `text-muted-foreground` | Smaller size + `text-slate-400` |

Reserve accent/brand color for CTAs and key UI, not body text.

---

## UX principles

- **Fast input**: Optimize tab order, use presets or shortcuts where it fits, combine related steps (e.g. create + add in one flow).
- **Feedback**: Update UI right after mutations (invalidate queries, toasts for destructive or important actions). Use `disabled` + a spinner on `Button` during submits.
- **Low cognitive load**: Few, clear actions per screen; constrained choices (e.g. fixed categories with icons); avoid wizards when a single form is enough.
- **Empty and loading**: Always handle empty data (centered message + short guidance) and loading (`Skeleton` sized to final content, or a `Loader2` spinner from Lucide).

---

## Layout and spacing

- **Spacing scale**: Use Tailwind spacing consistently (e.g. `gap-2`/`p-2` for inline, `gap-4`/`p-4` for cards/sections, `gap-6`/`py-6` for page rhythm).
- **Responsive**: Use Tailwind breakpoints (`sm:`, `md:`, `lg:`). Single column on mobile; sidebars/panels as toggles or Sheets (`<Sheet>`) on small screens. Use `flex-wrap` and `min-w-0` to avoid overflow.
- **Content width**: Constrain main content (e.g. `max-w-2xl mx-auto`) for readability on wide viewports.

---

## Component patterns

- **shadcn/ui first**: Use shadcn/ui primitives for actions, forms, and feedback: `Button`, `Input`, `Card`, `Dialog`, `DropdownMenu`, `Select`, `Textarea`, `Badge`, `Skeleton`, etc. Do not replace them with raw HTML for interactive elements.
- **Forms**: Use `react-hook-form` with `zod` for validation. Wrap inputs in `<FormField>`, `<FormItem>`, `<FormLabel>`, `<FormControl>`, `<FormMessage>` from `@/components/ui/form`.
- **Toast / notifications**: Use `sonner` (`toast.success(...)`, `toast.error(...)`) or shadcn/ui's `useToast` hook. Prefer `sonner` for simplicity.
- **Composition**: Pass data and callbacks into components (e.g. `onSubmit`, `onClose`), not big config objects.
- **Icons**: Use **Lucide React** (`lucide-react`) consistently throughout the app. Apply `text-muted-foreground` or contextual color classes for icon meaning (e.g. status, category).
- **Loading**: Add `disabled` to the button and show a `<Loader2 className="animate-spin" />` icon inside it while a request is in flight; use `<Skeleton>` for content placeholders.

---

## State and feedback

- **Cursor**: Always add `cursor-pointer` to interactive elements (buttons, links, clickable cards) including shadcn/ui `Button`. For custom `<button>` elements or `<div onClick>` handlers, always include `cursor-pointer` in the Tailwind class list. For disabled states use `cursor-not-allowed` (and remove `cursor-pointer`).
- **Hover/active**: Rely on shadcn/ui component variants and Tailwind `hover:` utilities; avoid overriding styles on interactive elements without a clear reason.
- **Errors**: Show inline validation messages via `<FormMessage>` and a toast or inline alert for API errors. See **handling-authentication-errors** for 401/token expiry.
- **Success**: Toast or brief inline confirmation for saves and destructive actions.

---

## Accessibility

- Use semantic structure: headings, `<label>` for inputs, landmarks where relevant.
- shadcn/ui components are built on Radix UI primitives — keyboard navigation and ARIA attributes are handled automatically; do not override or remove them.
- Use `<FormLabel>` for all form inputs so labels are always associated.
- Keep contrast in mind when picking palettes (CSS variable tokens help ensure consistency).

---

## Dark mode

**With shadcn/ui**: Dark mode is toggled by adding/removing the `dark` class on `<html>`. Use CSS variable-based tokens (`bg-background`, `text-foreground`, etc.) which are registered through shadcn/ui's theme system.

**Without shadcn/ui**: Use Tailwind's `dark:` variant with the built-in palette: `bg-white dark:bg-slate-900`, `text-slate-900 dark:text-slate-100`. Do NOT create raw `:root` CSS variables and reference them via `bg-[var(--name)]` — this does not work in Tailwind v4 (see Tailwind CSS v4 section above).

---

<% if (it.flags?.includes("site-embed-theme")) { %>
## Embedded in a FuseBase site

The slate/white palette guidance above does **not** apply while this flag is on.
Those classes ignore the site. Use shadcn token utilities throughout.

An app can be framed by a site built in Web Studio. The site posts
`{ type: 'fb:embed:hello', v: 1, theme, colorScheme }` into the frame. **app-wrapper**
is the receiver: it validates each value, maps the fourteen site tokens onto shadcn
variables on `<html>`, and toggles the `dark` class from `colorScheme`. The app does
not listen, validate, or call `setProperty` — a second listener would race the wrapper.

### What the wrapper sets (site token → shadcn variables)

| Site token       | Lands on `<html>` as                                      | Use in the app                         |
| ---------------- | --------------------------------------------------------- | -------------------------------------- |
| `background`     | `--background`                                            | `bg-background`                        |
| `foreground`     | `--foreground`, `--card-foreground`                       | `text-foreground`                      |
| `surface`        | `--card`, `--popover`, `--muted`                          | `bg-card`, `bg-muted`                  |
| `muted`          | `--muted-foreground`                                      | `text-muted-foreground`                |
| `line`           | `--border`, `--input`                                     | `border-border`                        |
| `accent`         | `--primary`, `--ring`                                     | `bg-primary`, `ring-ring`              |
| `accentContrast` | `--primary-foreground`                                    | `text-primary-foreground`              |
| `hover`          | `--accent`                                                | hover/selection fill, **not** brand    |
| `danger`         | `--destructive`                                           | error / destructive                    |
| `radius`         | `--radius`                                                | `rounded-*`                            |
| `fontBody`       | `--font-sans`                                             | body and headings                      |
| `fontMono`       | `--font-mono`                                             | `font-mono`                            |

Not forwarded: `fontHeading` (headings use `--font-sans`), `codeSurface`. Also unset:
`--popover-foreground`, `--accent-foreground`, `--secondary-foreground`,
`--destructive-foreground`. Prefer `text-foreground` / `text-primary-foreground`.

Success green and warning amber stay the app's own values. A site's palette is
appearance, not meaning. Use `--destructive` for error and destructive text.

### What that requires of the app

**Every visible surface has to be expressed in these tokens.** Body, headings, links,
tables, cards, inputs, badges, hover/focus/disabled, scrollbars, sticky chrome. A
component left as `bg-slate-900` or `text-white` stays that colour while the rest of
the page follows the site — unreadable if the site went the other way.

**Register the tokens through `@theme inline`**, which is what a standard shadcn/ui
setup already does:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
}
```

`inline` matters. Without it Tailwind resolves the variable once at build time and a
runtime override changes nothing — the utility keeps the value the app shipped with.

**Never hard-code the contrast colour on an accent.** Use `text-primary-foreground`.
A site's accent can be light or dark, and `text-white` on a pale accent is the one
failure a theme must never produce.

**Do not fight the `dark` class or `color-scheme`.** The wrapper sets both from
`colorScheme`. An app that applies its own theme on load will flicker and then disagree.

**Do not add a height reporter.** The wrapper already posts `fbs-iframe-resize` and
`fb:embed:height`. A second producer of height for the same frame is a resize loop.

### Testing it

Standalone, the wrapper sets nothing — the app's `:root` values are the defaults, so a
token-themed app still looks right on its own. That is necessary, not sufficient.

Hunt leftover fixed colours (`bg-white`, `bg-slate-*`, `text-white` on buttons, hex in
`style=`). A palette close to the app's defaults proves nothing; those classes would
also look fine against a near-default site and fail against a loud one. Absence of a
theme is a supported state: with no greeting the page must be exactly as it is unframed.

<% } %>
---

## References

- **shadcn/ui**: https://ui.shadcn.com — components, theming, and CLI usage.
- **Radix UI**: Underlying primitive library providing accessible behavior for shadcn/ui components.
- **Lucide React**: https://lucide.dev — icon set to use consistently.
- **AGENTS.md**: Use shadcn/ui for app UIs; auth and SDK usage are described there and in **fusebase-dashboards**, **handling-authentication-errors**.
