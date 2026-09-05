import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import {
  authenticate, can, createSession, isManager, permissionsFor, resolveSession, revokeSession,
  type Permission, type SessionUser,
} from '../domain/auth.js';
import { registerPortalRoutes } from './portal.js';
import { registerApiRoutes } from './routes.js';

const SESSION_COOKIE = 'yad_sales_session';
const assetsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'assets');

/** The error page renders one sentence; it still escapes it. */
function escapeHtmlText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] as string));
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Never log credentials or session tokens.
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password'],
    },
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  // Cal.com signs the raw body, so it must be preserved before JSON parsing.
  app.addContentTypeParser('application/json', { parseAs: 'string' },
    (request, body: string, done) => {
      (request as { rawBody?: string }).rawBody = body;
      try {
        done(null, body.length > 0 ? JSON.parse(body) : {});
      } catch (error) {
        done(error as Error, undefined);
      }
    });

  await app.register(cookie, { secret: config.portal.sessionSecret });
  await app.register(formbody);
  // Prospect-list uploads. Capped so a large file cannot exhaust memory.
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 20 },
  });
  await app.register(fastifyStatic, {
    root: assetsDir,
    prefix: '/assets/',
    cacheControl: true,
    maxAge: config.isProduction ? '1h' : 0,
  });

  // Baseline security headers. The portal serves no third-party script, so the
  // policy can be strict; 'unsafe-inline' covers the small per-page inline blocks.
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    return payload;
  });

  // Health check: no auth, no data.
  app.get('/healthz', async (_request, reply) => {
    try {
      await pool.query('select 1');
      return { status: 'ok', database: 'ok', outboundDialEnabled: config.outbound.dialEnabled };
    } catch {
      reply.code(503);
      return { status: 'degraded', database: 'unreachable' };
    }
  });

  // Session resolution runs before every route; authorization is per-route below.
  app.addHook('preHandler', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    const user = await resolveSession(token);
    if (user) request.user = user;
  });

  registerAuthRoutes(app);
  await registerPortalRoutes(app);
  await registerApiRoutes(app);

  /**
   * One place where a thrown error becomes a response.
   *
   * Without this, a bad id in the URL bar reached PostgreSQL, and Fastify's default
   * handler answered with the database's own words -- 'invalid input syntax for type
   * uuid: "abc"' -- which tells a visitor the column type, the driver and that their
   * input reached SQL. The real error is logged; the browser gets a sentence.
   */
  app.setErrorHandler((raw, request, reply) => {
    const error = raw as Error & { statusCode?: number; code?: string };
    const status = typeof error.statusCode === 'number' && error.statusCode >= 400
      && error.statusCode < 500 ? error.statusCode : 500;
    const pgCode = error.code;

    // A malformed id or number is the caller's mistake, not a server fault, and it
    // must not be logged as an outage or answered with a 500.
    const badInput = pgCode === '22P02' || pgCode === '22003' || pgCode === '22001';
    const code = badInput ? 400 : status;

    if (code >= 500) {
      request.log.error({ err: error, url: request.url }, 'unhandled request error');
    } else {
      request.log.warn({ err: error.message, code: pgCode, url: request.url }, 'rejected request');
    }

    const message = badInput
      ? 'That request contained something this page cannot read.'
      : code >= 500
        ? 'Something went wrong on our side. It has been logged.'
        : error.message;

    if (reply.sent) return;
    if (request.url.startsWith('/api/')) {
      reply.code(code).send({ ok: false, message });
      return;
    }
    reply.code(code).type('text/html')
      .send(`<p>${escapeHtmlText(message)}</p><p><a href="/">Go to the portal</a>.</p>`);
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404).send({ ok: false, message: 'Not found' });
      return;
    }
    reply.code(404).type('text/html').send('<p>Not found. <a href="/">Go to the portal</a>.</p>');
  });

  return app;
}

function registerAuthRoutes(app: FastifyInstance): void {
  app.get('/login', async (request, reply) => {
    if (request.user) return reply.redirect('/');
    const { renderLogin } = await import('../web/layout.js');
    return reply.type('text/html').send(renderLogin({}));
  });

  app.post<{ Body: { email?: string; password?: string } }>('/login', async (request, reply) => {
    const { renderLogin } = await import('../web/layout.js');
    const email = String(request.body?.email ?? '');
    const password = String(request.body?.password ?? '');

    const result = await authenticate(email, password, { ip: request.ip });
    if (!result.ok || !result.user) {
      request.log.warn({ email, ip: request.ip, reason: result.reason }, 'failed sign-in');
      if (result.reason === 'RATE_LIMITED') {
        const minutes = Math.ceil((result.retryAfterSeconds ?? 60) / 60);
        reply.header('Retry-After', String(result.retryAfterSeconds ?? 60));
        return reply.code(429).type('text/html').send(renderLogin({
          error: `Too many sign-in attempts. Try again in about ${minutes} minute`
            + `${minutes === 1 ? '' : 's'}.`,
          email,
        }));
      }
      // The same message for a bad password and a disabled account: a sign-in form
      // should not confirm which addresses exist.
      return reply.code(401).type('text/html').send(
        renderLogin({ error: 'That email and password combination was not recognized.', email }),
      );
    }

    const session = await createSession(result.user.userId, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
    reply.setCookie(SESSION_COOKIE, session.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.portal.sessionCookieSecure,
      expires: session.expiresAt,
    });
    await pool.query(
      `insert into audit_log (actor_user_id, action, subject_type, subject_id, ip)
       values ($1::uuid, 'auth.login', 'user', $1::text, $2)`,
      [result.user.userId, request.ip],
    );
    return reply.redirect('/');
  });

  app.post('/logout', async (request, reply) => {
    await revokeSession(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.redirect('/login');
  });
}

/** HTML routes: bounce anonymous visitors to the sign-in form. */
export function requireUser(request: FastifyRequest, reply: FastifyReply): SessionUser | null {
  if (!request.user) {
    reply.redirect('/login');
    return null;
  }
  return request.user;
}

/** JSON routes: 401 rather than a redirect, so fetch() can react. */
export function requireApiUser(request: FastifyRequest, reply: FastifyReply): SessionUser | null {
  if (!request.user) {
    reply.code(401).send({ ok: false, message: 'Not signed in' });
    return null;
  }
  return request.user;
}

export function requirePermission(
  request: FastifyRequest, reply: FastifyReply, permission: Permission,
): SessionUser | null {
  const user = requireApiUser(request, reply);
  if (!user) return null;
  if (!can(user.role, permission)) {
    reply.code(403).send({ ok: false, message: 'You do not have permission to do that.' });
    return null;
  }
  return user;
}

export { SESSION_COOKIE, isManager, permissionsFor };
