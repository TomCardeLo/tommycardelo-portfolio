export const languages = {
  en: "English",
  es: "Español",
} as const;

export type Lang = keyof typeof languages;
export const defaultLang: Lang = "en";

/** Extract locale from URL pathname: /es/... → "es", anything else → "en" */
export function getLangFromUrl(url: URL): Lang {
  const [, maybeLocale] = url.pathname.split("/");
  if (maybeLocale in languages) return maybeLocale as Lang;
  return defaultLang;
}

/** Return a path prefixed with the locale (default locale has no prefix). */
export function getLocalePath(lang: Lang, path: string): string {
  if (lang === defaultLang) return path;
  return `/es${path === "/" ? "" : path}`;
}

// ─── Translation dictionary ────────────────────────────────────────────────

export const ui = {
  en: {
    // Navigation
    "nav.posts": "Posts",
    "nav.tags": "Tags",
    "nav.about": "About",
    "nav.archives": "Archives",
    "nav.search": "Search",
    // Home hero
    "home.greeting": "Hi, I'm Tommy",
    "home.bio":
      "Data Scientist & AI Engineer based in Bogotá. I work at the intersection of ML models, LLM automation, and data systems at scale. Currently at Kimberly-Clark (LATAM) and as an independent consultant at 2DATO.",
    "home.readMorePre": "Explore my technical notes and projects, or check the",
    "home.readMoreLink": "About",
    "home.readMorePost": "section for more.",
    "home.socialLinks": "Social Links:",
    "home.featured": "Featured",
    "home.recentPosts": "Recent Posts",
    "home.allPosts": "All Posts",
    // Posts listing
    "posts.title": "Posts",
    "posts.desc": "All the articles I've posted.",
    // Tags
    "tags.title": "Tags",
    "tags.desc": "All the tags used in posts.",
    "tags.articlesWith": "All the articles with the tag",
    // Archives
    "archives.title": "Archives",
    "archives.desc": "All the articles I've archived.",
    // Search
    "search.title": "Search",
    "search.desc": "Search any article...",
    // About
    "about.title": "About",
    // Pagination
    "pagination.prev": "Prev",
    "pagination.next": "Next",
    // Footer
    "footer.rights": "All rights reserved.",
    // Breadcrumb
    "breadcrumb.home": "Home",
    // Month names (used in archives)
    "months.1": "January",
    "months.2": "February",
    "months.3": "March",
    "months.4": "April",
    "months.5": "May",
    "months.6": "June",
    "months.7": "July",
    "months.8": "August",
    "months.9": "September",
    "months.10": "October",
    "months.11": "November",
    "months.12": "December",
  },
  es: {
    // Navigation
    "nav.posts": "Posts",
    "nav.tags": "Etiquetas",
    "nav.about": "Sobre mí",
    "nav.archives": "Archivo",
    "nav.search": "Buscar",
    // Home hero
    "home.greeting": "Hola, soy Tommy",
    "home.bio":
      "Data Scientist & AI Engineer con base en Bogotá. Trabajo en la intersección de modelos ML, automatización con LLMs y sistemas de datos a escala. Actualmente en Kimberly-Clark (LATAM) y como consultor independiente en 2DATO.",
    "home.readMorePre":
      "Explora mis notas técnicas y proyectos, o pásate por la sección",
    "home.readMoreLink": "About",
    "home.readMorePost": "para saber más.",
    "home.socialLinks": "Social Links:",
    "home.featured": "Destacados",
    "home.recentPosts": "Artículos recientes",
    "home.allPosts": "Ver todos",
    // Posts listing
    "posts.title": "Posts",
    "posts.desc": "Todos los artículos que he publicado.",
    // Tags
    "tags.title": "Etiquetas",
    "tags.desc": "Todas las etiquetas usadas en los posts.",
    "tags.articlesWith": "Todos los artículos con la etiqueta",
    // Archives
    "archives.title": "Archivo",
    "archives.desc": "Todos los artículos archivados.",
    // Search
    "search.title": "Buscar",
    "search.desc": "Busca cualquier artículo...",
    // About
    "about.title": "Sobre mí",
    // Pagination
    "pagination.prev": "Ant.",
    "pagination.next": "Sig.",
    // Footer
    "footer.rights": "Todos los derechos reservados.",
    // Breadcrumb
    "breadcrumb.home": "Inicio",
    // Month names (used in archives)
    "months.1": "Enero",
    "months.2": "Febrero",
    "months.3": "Marzo",
    "months.4": "Abril",
    "months.5": "Mayo",
    "months.6": "Junio",
    "months.7": "Julio",
    "months.8": "Agosto",
    "months.9": "Septiembre",
    "months.10": "Octubre",
    "months.11": "Noviembre",
    "months.12": "Diciembre",
  },
} as const;

export type TranslationKey = keyof (typeof ui)[typeof defaultLang];

/** Returns a t() function bound to the given language. Falls back to EN. */
export function useTranslations(lang: Lang) {
  return function t(key: TranslationKey): string {
    return (
      (ui[lang] as Record<string, string>)[key] ??
      (ui[defaultLang] as Record<string, string>)[key] ??
      key
    );
  };
}
