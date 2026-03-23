# Design System Document

## 1. Overview & Creative North Star: "The Neon Monastery"
This design system is a manifestation of "The Neon Monastery"—a visual language that bridges the gap between divine architectural reverence and high-tech futurism. We are moving beyond the cluttered "gamer" aesthetic to something far more "ascetic" (禁慾): a sterile, minimalist environment where every pixel feels intentional, high-end, and slightly mysterious.

### Creative North Star
Our goal is to create a digital cathedral. The interface should feel like an expensive, glass-and-brass instrument found in a futuristic sanctuary. We achieve this by:
*   **Intentional Asymmetry:** Breaking the expected 12-column grid to allow for significant "void" spaces, mimicking the vastness of a temple.
*   **Overlapping Sacred Geometry:** Floating glass panels and metallic accents should overlap content, creating depth and a sense of physical layering.
*   **Atmospheric Tension:** High-contrast typography paired with a muted, sterile base allows the vibrant Mint and Gold accents to feel like sacred artifacts rather than mere UI elements.

## 2. Colors
The palette is centered on a tension between deep, sterile neutrals and a vibrant, "retro-future" teal/mint.

*   **Primary (`#90decd`):** The "Green Diva" signature. Use this sparingly for key focal points.
*   **Secondary (`#e9c176`):** The Metallic Gold. Reserved for moments of high ritual—success states, primary CTAs, or subtle brass-like strokes.
*   **Surface Hierarchy (`#121414` base):** Depth is built through tonal shifts, not lines.
    *   **The "No-Line" Rule:** Never use 1px solid borders to section content. Boundaries must be defined by shifting from `surface` to `surface-container-low` or `surface-container-highest`.
    *   **Glassmorphism:** For floating menus or overlays, use semi-transparent `surface` values with a `backdrop-blur(20px)` to simulate the helmet visor in the reference image.
    *   **Signature Texture:** Use a subtle radial gradient transitioning from `primary` to `primary_container` for hero button backgrounds to give them a "glowing" lacquer finish.

## 3. Typography
The typography system is a dialogue between the "Sacred" (Serif) and the "Scientific" (Sans/Grotesk).

*   **The Sacred (Noto Serif):** Used for `display` and `headline` scales. This represents the "religion" aspect. It should feel elegant, slightly ornate, and authoritative.
*   **The Scientific (Manrope & Space Grotesk):** 
    *   **Manrope:** Used for `body` and `title` text. It provides a clean, neutral balance to the serif headers.
    *   **Space Grotesk:** Reserved for `labels` and technical data. Its geometric nature reinforces the "future" aspect of the brand.
*   **Hierarchy:** To emphasize the high-end editorial feel, use extreme scale contrast. A `display-lg` headline should often be paired with a much smaller `body-sm` description to create visual "drama."

## 4. Elevation & Depth
In this system, elevation is an atmospheric quality, not a drop-shadow.

*   **Tonal Layering:** Depth is achieved by "stacking" surface tiers. Place a `surface-container-lowest` card against a `surface-container-low` background to create a soft, natural indentation.
*   **Ambient Shadows:** If a floating effect is required, shadows must be ultra-diffused. Use a blur of `32px` at `6%` opacity. The shadow color must be a tinted version of `on-surface` (`#e2e2e2`) to mimic light refracting through glass rather than a black smudge.
*   **The Ghost Border:** If a container requires definition for accessibility, use a "Ghost Border": the `outline-variant` token at `15%` opacity. 
*   **Reflective Accents:** Use the `secondary` (Gold) color as a thin, top-aligned 1px "highlight" on the top edge of dark containers to mimic light hitting a brass rim.

## 5. Components

### Buttons
*   **Primary:** Background of `primary` gradient, text in `on_primary`. Roundedness: `md` (`0.375rem`). No border.
*   **Secondary (Brass/Gold):** Outline of `secondary` at 50% opacity, text in `secondary`.
*   **Tertiary:** Text-only in `primary_fixed_dim`, capitalized Space Grotesk labels for a technical feel.

### Input Fields
*   **Style:** No background. A single bottom-border using `outline_variant` at 20% opacity. 
*   **Focus State:** The bottom border transitions to 100% `primary` with a subtle `primary` outer glow (4px blur).
*   **Labels:** Use `label-sm` in `Space Grotesk`, positioned significantly above the input to create "ascetic" white space.

### Cards & Lists
*   **Rule:** Forbid divider lines.
*   **Separation:** Use the Spacing Scale (specifically `8` or `10`) to create breathing room. Content groups should be separated by a shift from `surface` to `surface_container`.
*   **Interaction:** On hover, a card should shift from `surface_container` to `surface_bright` with a 200ms ease-in-out transition.

### Floating "Visor" Orbs (Custom Component)
*   Used for status indicators or notification counts. A circular element using the `primary` color with a `0.5` opacity white "reflection" gradient on the top-left quadrant, mimicking the helmet's specular highlights.

## 6. Do's and Don'ts

### Do
*   **DO** use extreme vertical margins (`spacing.16` or `spacing.20`) to frame important content.
*   **DO** mix Serif and Sans-Serif within the same component to create a "curated" look.
*   **DO** use "Brass" (`secondary`) exclusively for precious details—icons, thin underlines, or subtle highlights.

### Don't
*   **DON'T** use 100% opaque borders or dividers. It breaks the "ascetic" flow.
*   **DON'T** use standard blue/red for success/error if possible; use `primary` (Teal) for success and a muted, desaturated version of `error` to maintain the palette's mystery.
*   **DON'T** crowd the layout. If a section feels "busy," increase the spacing by two increments on the scale.