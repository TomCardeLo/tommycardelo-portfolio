---
author: Tommy CardeLo
pubDatetime: 2026-10-15T11:00:00Z
title: "Versavi — A storefront for hand-painted wooden earrings, with no framework and no build step"
featured: false
draft: false
tags:
  - javascript
  - firebase
  - n8n
  - github-actions
  - playwright
  - web-design
lang: en
description: "How I built a static, dependency-free storefront for Versavi, a small handmade brand: a seasonal catalog, an email-based cart, n8n forms so the owner manages her own pieces, and a placeholder inventory to collect real content."
---

> A static storefront for Versavi, a small brand of hand-painted wooden earrings: plain HTML, CSS and JS with no build step, a seasonal "field guide" catalog, a cart that sends one prefilled email, and n8n forms that let the owner add, edit and delete pieces herself.

Site: [versavi.store](https://versavi.store)

---

## The problem

A one-person handmade brand lives on Instagram, but Instagram is a bad catalog. There are no stable prices, no way to browse by theme, and every sale starts with a DM thread. The owner needed three things: a place to point people to, a way to take an order without me in the loop, and a way to keep growing the catalog without paying me for every new pair of earrings.

The constraints shaped everything else. Traffic is small, the budget is close to zero, and the person maintaining content is an artist, not a developer. So the real question was never "which framework", but "what is the least machinery that can still feel like a crafted brand?"

## What it does

- **Home page** with a scroll-driven animated garden that moves through four seasons, followed by one block per season generated from the catalog.
- **Shop and product pages**: a filterable grid (`?season=`) and a product page with a photo gallery and a design selector for pieces that come in several variants.
- **Cart** shared by every page. It lives in `localStorage` and turns into one prefilled email order.
- **Custom order section**, because commissioned pieces are part of the offer.
- **Legal pages, 404, sitemap and social previews**, added in a launch-checklist pass.
- **Two n8n forms** where the owner uploads, edits and deletes pieces without touching code.

## Architecture

```
Browser
  index.html / shop.html / product.html
    ├─ catalog-data.js   strict JSON: slug, name, price, season, photos/designs
    ├─ catalog.js        cards + reveal + cache-busting
    ├─ cart.js           localStorage → one mailto: order
    └─ garden.js         four-season hero, driven by scroll

Owner (phone)
  n8n form ──► validate ──► resize photos to webp
           ──► one Git commit to main (photos + catalog-data.js + sitemap.xml)
                     │
                     ▼
        GitHub Actions ──► Firebase Hosting (custom domain, SSL)
```

The whole site is a folder of static files. There is no bundler, no package manager and no dependency to update. The catalog is a single JSON array assigned to `window.VERSA_RAW`, and every page renders from it.

## Key design decisions

### 1. Static files, on purpose

For a site this size, a framework would mostly add things that can break. Static HTML on Firebase Hosting's free tier costs nothing, serves fast, and has nothing to patch. I measured a full home-page visit at roughly 1 MB, which fits comfortably inside the free quota for the traffic this brand can expect. The upgrade path is clear: move to a paid plan only if I need a backend, such as real payments, or if traffic gets close to the limit.

### 2. Design direction: a seasonal field guide

The brand paints on small wooden circles, and the pieces group naturally by season (fruit and ocean in summer, blossoms in spring). So the site became a field guide to a garden: each piece appears as a specimen on its season's color, cropped to the wooden circle, with a hanging tag.

I kept the original palette and typography (teal, terracotta and cream, Baloo 2 plus Nunito Sans) instead of redesigning around the logo. That was a deliberate trade-off: the client had already approved the look, and a consistent site beats a theoretically better one that needs approval all over again. The most recent redesign pass removed things that had accumulated, such as a marquee and some decorative creatures, and I tagged the previous version in git so anything can be brought back.

### 3. Orders go out as one email, not through a checkout

A real checkout means a payment provider, a backend and compliance work. For a seller who confirms shipping and payment personally, none of that pays for itself yet. The cart collects the pieces, the customer's name, a contact and an optional address, and builds one `mailto:` message. The owner replies with the final total and her payment options.

It is honest about its limits: the page says the email app will open, and shows the address as a fallback if it does not. The cart also survives browsers that block storage, falling back to memory instead of throwing.

### 4. Let the owner publish without me

The most useful part was not visual. I replaced "send me photos and I will add them" with two n8n forms: one to upload a piece (name, price, season, description, 1 to 6 photos) and one to edit or delete existing ones. Each submission validates the data, converts photos to bounded-size webp (fixing phone orientation), and makes a **single commit** to `main` through the GitHub API. That commit contains the images, the updated catalog and the sitemap, and CI deploys it.

One commit per change keeps the history readable and makes every change revertible. It also forced a rule I like: `catalog-data.js` must stay strict JSON, because a machine writes it as well as a person. On the site side, `build()` drops any piece with an invalid slug, price or season and logs a warning, so a bad entry cannot take the page down. Photos are cached for a week, so each edit adds a version parameter to the image URLs.

### 5. A placeholder inventory for real content

The first version shipped with striped "photo pending" boxes, a "number to be confirmed" in the footer and prices I had made up for layout. Left alone, placeholders go live. So I treated them as an inventory: a document listing every placeholder, where it appears on the site, and the exact question or file needed to replace it (contact channels, bio details, real prices, shipping and payment, returns, plus a photo checklist with technical notes for whoever takes the pictures).

When the answers arrived, I applied them in one pass: a real catalog, real shipping and payment terms, and the true scope of the brand's work. I later removed the "photo pending" boxes from the live site entirely, so unfinished content stays hidden instead of looking broken. Two gaps remain on purpose, a portrait of the owner and process photos, and the site uses stand-ins until those arrive.

### 6. Performance and SEO, with an honest number

A launch checklist covered canonical URLs (including a 301 from `www` to the main domain), Open Graph previews, sitemap and robots, a 404 page, legal pages and AA contrast. A local Lighthouse run scored 93 for performance and 100 for accessibility, best practices and SEO. Largest Contentful Paint sits around 3.2 s because of the hero's entrance animation, and I accepted that trade-off knowingly. I did not install analytics, which also means no cookie banner is needed. The site is English only, matching the customers.

## Testing

Everything is verified with end-to-end tests in Playwright (Python): 196 checks across the three page types, including content visibility, a deliberately broken catalog, the season buttons and the product re-render. A separate E2E drives the n8n forms against production: it publishes a test piece, edits it, deletes it, and checks that the catalog and sitemap end up identical to how they started, with no email going to the client. Reports and screenshots are saved as artifacts.

## What I learned

- Stale cached CSS broke the animated garden once. With static hosting, decide cache headers per file type up front: long for images, `no-cache` for HTML, CSS and JS.
- A scroll-smoothing library I tried caused a bounce at one section, so I dropped it. Native `scroll-behavior` was good enough.
- Scope drift is real. I had generalized the copy to "jewelry" before the owner's own bio set the true scope. Take the client's words as the source of truth.
- The best "feature" was removing myself from the content loop.

## What's next

Real photos for the remaining collections, the owner's portrait and process shots, and confirming the sample copy she has not reviewed yet. If traffic grows, the video clip on the home page is the first thing to watch, since it adds the most weight per visit.

## Stack

HTML · CSS · vanilla JavaScript · Firebase Hosting (free tier, custom domain) · GitHub Actions · n8n (self-hosted, forms and GitHub API) · Playwright (Python) · Lighthouse
