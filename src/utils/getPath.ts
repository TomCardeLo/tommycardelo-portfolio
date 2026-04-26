import { BLOG_PATH } from "@/content.config";
import { defaultLang, languages } from "@/i18n/ui";
import { slugifyStr } from "./slugify";

/**
 * Get full path of a blog post
 * @param id - id of the blog post (aka slug)
 * @param filePath - the blog post full file location
 * @param includeBase - whether to include `/posts` in return value
 * @returns blog post path
 */
export function getPath(
  id: string,
  filePath: string | undefined,
  includeBase = true
) {
  const pathSegments =
    filePath
      ?.replace(BLOG_PATH, "")
      .split("/")
      .filter(path => path !== "") // remove empty string in the segments ["", "other-path"] <- empty string will be removed
      .filter(path => !path.startsWith("_")) // exclude directories start with underscore "_"
      .slice(0, -1) // remove the last segment_ file name_ since it's unnecessary
      .map(segment => slugifyStr(segment)) ?? []; // slugify each segment path

  // Locale subdirectories (e.g. "es") belong BEFORE /posts in the URL,
  // i.e. /es/posts/<slug> — not /posts/es/<slug>.
  const localeKeys = Object.keys(languages).filter(key => key !== defaultLang);
  const localeSegments = pathSegments.filter(s => localeKeys.includes(s));
  const dirSegments = pathSegments.filter(s => !localeKeys.includes(s));

  const basePath = includeBase ? "/posts" : "";
  const localePrefix = localeSegments.length
    ? "/" + localeSegments.join("/")
    : "";

  // Making sure `id` does not contain the directory
  const blogId = id.split("/");
  const slug = blogId.length > 0 ? blogId.slice(-1) : blogId;

  // If not inside an extra sub-dir, return locale + base + slug
  if (dirSegments.length < 1) {
    return [localePrefix + basePath, slug].join("/");
  }

  return [localePrefix + basePath, ...dirSegments, slug].join("/");
}
