# Portfolio – Tommy CardeLo

## Blog Post Convention: Bilingual (EN + ES) required

Every blog post **must** be created in both English and Spanish.

### File structure

```
src/data/blog/
├── my-post.md          ← English version  (lang: en)
└── es/
    └── my-post.md      ← Spanish version  (lang: es)
```

Both files must share the **same filename** so the language switcher can link between them correctly (e.g. `/posts/my-post` ↔ `/es/posts/my-post`).

### Required frontmatter fields

**English** (`src/data/blog/my-post.md`):
```yaml
---
author: Tommy CardeLo
pubDatetime: 2026-01-01T10:00:00Z
title: My Post Title
featured: false
draft: false
tags:
  - tag-name
lang: en
description: Short description in English.
---
```

**Spanish** (`src/data/blog/es/my-post.md`):
```yaml
---
author: Tommy CardeLo
pubDatetime: 2026-01-01T10:00:00Z
title: Título del post
featured: false
draft: false
tags:
  - tag-name
lang: es
description: Descripción corta en español.
---
```

### Rules
- `lang: en` is required on every EN post (not just default)
- `lang: es` is required on every ES post
- Both versions must have the **same `pubDatetime`** and **same `tags`**
- The `featured` flag should be identical in both versions
- Write EN first, then translate to ES — or vice versa, but always create both before publishing

### How language routing works
- EN posts at `src/data/blog/*.md` render to `/posts/<slug>`
- ES posts at `src/data/blog/es/*.md` render to `/es/posts/<slug>`
- The LangSwitch component in the header automatically links `/posts/my-post` ↔ `/es/posts/my-post`
- All listing, tag, and archive pages are filtered by `data.lang`
