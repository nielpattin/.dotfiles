---
name: landing-page
description: Create high-converting landing pages with optimized copy, structure, and modern design systems. Evaluate and build pages for SaaS, developer tools, lead generation, and product launches with conversion-focused layouts.
---

# Landing Page Design

Build high-converting, modern landing pages with persuasive copy, optimized structure, and professional design systems.

## When to Use This Skill

Use this skill for:
- Lead generation campaigns
- Product launch pages
- SaaS application landing pages
- Event registration and webinars
- Free trial sign-ups
- Portfolio and personal brand sites
- App download campaigns

## Design Principles

### Core Principles
- **Mobile-first responsive design** with breakpoint optimization
- **Single focus** — one primary goal per page
- **Accessibility-first** with ARIA labels and semantic HTML
- **Performance optimization** with minimal CSS and efficient animations
- **Show, don't tell** — product screenshots/demos beat stock photos

### Style Categories

#### Minimalist Professional
- Clean typography with generous whitespace
- Neutral color palette with strategic accent colors
- Subtle shadows and minimal animations
- Focus on content hierarchy and readability

#### Modern SaaS
- Bold gradients and vibrant colors
- Card-based layouts with elevation
- Micro-interactions and hover states
- Dashboard-style components

#### Developer-Focused (Signal Mono)
- Monospace typography throughout
- Dark mode first, high contrast
- Technical prefixes (`//`, `>`)
- Flat design, minimal decoration

## Landing Page Framework

### Essential Elements
Every high-converting landing page includes:

| Element | Purpose |
|---------|---------|
| **Compelling Headline** | Clear value proposition in 6-10 words |
| **Supporting Subheadline** | Elaborates on main benefit |
| **Hero Image/Video** | Visually supports the main message |
| **Benefits Section** | Focus on user outcomes, not features |
| **Social Proof** | Testimonials, reviews, trust badges, user counts |
| **Call-to-Action** | Clear, prominent, action-oriented |
| **Trust Signals** | Security badges, guarantees, open source indicators |

### Conversion Optimization
- **Above-Fold CTA**: Primary action visible without scrolling
- **Urgency Elements**: Limited time offers, scarcity indicators (use sparingly)
- **Progressive Disclosure**: Complex information revealed gradually
- **Risk Reversal**: Guarantees, free trials, easy cancellation

## Page Structure Templates

### Lead Generation Template
```
1. Headline + Value Proposition
2. Subheadline with Benefits
3. Hero Image/Video/Demo
4. Lead Magnet Description
5. Form (Minimal fields: Name, Email)
6. Social Proof (logos, testimonials)
7. Additional Benefits (3 feature cards)
8. FAQ Section
9. Footer with Trust Elements
```

### SaaS Product Template
```
1. Logo + Navigation
2. Hero: Problem → Solution headline
3. Product Demo/Screenshots
4. Features and Benefits (benefit-focused, not feature dumps)
5. Social Proof (user counts, testimonials, logos)
6. Pricing Options (if applicable)
7. Integration/Tech Stack
8. Final CTA
9. Footer
```

### Developer Tool Template
```
1. Logo Badge (// PRODUCT_NAME)
2. Hero Headline (technical, specific)
3. One-liner description
4. Primary CTA + Secondary CTA (View Source)
5. Feature Cards (3-4, with technical details)
6. Code Example or Terminal Demo
7. Integration/Installation snippet
8. Version/Status Badge
9. Footer
```

## Content Guidelines

### Headline Formulas
- **Benefit-first**: "Ship Faster with Type-Safe APIs"
- **Problem-solution**: "Stop Debugging. Start Building."
- **Specific outcome**: "Deploy in 30 Seconds"
- **For audience**: "The Kanban Board for Developer Teams"

### Copy Structure Patterns

| Pattern | Structure |
|---------|-----------|
| **PAS** | Problem → Agitation → Solution |
| **BAB** | Before → After → Bridge |
| **FAB** | Features → Advantages → Benefits |

### Writing Rules
- Lead with primary benefit
- Address target audience directly
- Use specific numbers and outcomes
- Keep headlines under 10 words
- Avoid jargon unless audience expects it

## Technical Implementation

### HTML Structure
```html
<header>  <!-- Logo + Nav -->
<main>
  <section class="hero">      <!-- Above fold -->
  <section class="features">  <!-- Value props -->
  <section class="proof">     <!-- Social proof -->
  <section class="cta">       <!-- Final conversion -->
</main>
<footer>  <!-- Trust elements -->
```

### Responsive Breakpoints
| Breakpoint | Target |
|------------|--------|
| `< 640px` | Mobile phones |
| `640-1024px` | Tablets |
| `> 1024px` | Desktop |

### Performance Checklist
- [ ] Images optimized and lazy-loaded
- [ ] Minimal blocking CSS/JS
- [ ] Above-fold content loads first
- [ ] Fonts preloaded or system fonts
- [ ] Core Web Vitals optimized

### Accessibility Checklist
- [ ] Semantic HTML (`<header>`, `<main>`, `<section>`)
- [ ] Proper heading hierarchy (h1 → h6)
- [ ] Alt text on all images
- [ ] ARIA labels on interactive elements
- [ ] Keyboard navigation works
- [ ] Color contrast meets WCAG AA

## Component Patterns

### Hero Section
- Headline (h1)
- Subheadline (p, muted)
- CTA buttons (primary + secondary)
- Optional: Product screenshot, demo GIF, or terminal animation

### Feature Cards
- Icon or prefix (`>`)
- Title (short, benefit-focused)
- Description (1-2 sentences max)
- 3-4 cards in a row on desktop, stacked on mobile

### Social Proof
- Logo strip (grayscale, 4-6 logos)
- Testimonial cards (photo, name, title, quote)
- Metrics ("10k+ developers", "99.9% uptime")

### CTA Buttons
- Primary: High contrast, action verb ("Get Started", "Try Free")
- Secondary: Ghost/outline style ("View Docs", "See Demo")
- Placement: Hero, after features, footer

## Anti-Patterns (Avoid)

| Don't | Why |
|-------|-----|
| Multiple CTAs with equal weight | Confuses user, splits attention |
| Generic stock photos | Reduces trust, looks inauthentic |
| Feature dumps without benefits | Users care about outcomes, not specs |
| Hidden pricing | Frustrates users, increases bounce |
| Auto-playing video with sound | Annoying, accessibility issue |
| Walls of text | Nobody reads, break into scannable chunks |
| Slow-loading hero images | Kills conversions, hurts SEO |

## Evaluation Checklist

When reviewing a landing page, check:

### Above the Fold
- [ ] Value proposition clear in 5 seconds?
- [ ] Primary CTA visible and compelling?
- [ ] Visual supports the message (not decorative)?

### Content Quality
- [ ] Benefits > Features?
- [ ] Specific outcomes mentioned?
- [ ] Social proof present?
- [ ] Trust signals visible?

### Technical Quality
- [ ] Mobile responsive?
- [ ] Fast loading (<3s)?
- [ ] Accessible?
- [ ] SEO basics (meta, headings)?

### Conversion Optimization
- [ ] Single clear goal?
- [ ] Minimal form fields?
- [ ] Urgency/scarcity (if appropriate)?
- [ ] Risk reversal (guarantee, free trial)?
