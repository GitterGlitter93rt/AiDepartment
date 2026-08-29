// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// https://astro.build/config
// output: 'static' — no adapter, no SSR, no Node.js runtime required at
// deploy time. Suitable for conventional static hosting (SiteGround).
export default defineConfig({
  output: 'static',
  site: 'https://youraidepartment.ai',
  trailingSlash: 'always',
  integrations: [mdx()],
  redirects: {
    // Retired paid-audit route -> permanent route. In static output
    // Astro emits a lightweight meta-refresh redirect page at the old
    // path (no duplicate indexable content — the old page no longer
    // exists as a route). When the site is served from SiteGround,
    // adding a real 301 .htaccess redirect for this path is preferable;
    // this config entry guarantees the old path never 404s either way.
    '/ai-department-audit': '/comprehensive-ai-business-audit/',
  },
});
