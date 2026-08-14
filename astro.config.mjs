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
});
