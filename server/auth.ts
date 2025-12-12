import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

// Demo flag: when DEV_NO_AUTH=1, bypass OIDC and expose stub routes
const DEV_BYPASS = process.env.DEV_NO_AUTH === "1";

// Neutralized env names with fallback to previous ones
const AUTH_ALLOWED_DOMAINS = process.env.AUTH_ALLOWED_DOMAINS ?? process.env.REPLIT_DOMAINS;
const OIDC_ISSUER_URL = process.env.OIDC_ISSUER_URL ?? process.env.ISSUER_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID ?? process.env.REPL_ID;

if (!DEV_BYPASS && !AUTH_ALLOWED_DOMAINS) {
  throw new Error("Environment variable AUTH_ALLOWED_DOMAINS not provided");
}

const getOidcConfig = memoize(
  async () => {
    if (!OIDC_ISSUER_URL || !OIDC_CLIENT_ID) {
      throw new Error("OIDC_ISSUER_URL and OIDC_CLIENT_ID must be set for OIDC auth");
    }
    return await client.discovery(new URL(OIDC_ISSUER_URL), OIDC_CLIENT_ID);
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: any) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  // Dev/demo mode
  if (DEV_BYPASS) {
    app.set("trust proxy", 1);

    // Simple in-memory session for demo
    app.use(session({
      secret: process.env.SESSION_SECRET || "dev-secret",
      resave: false,
      saveUninitialized: false,
    }));

    // Inject a fake authenticated user so downstream code can read req.user.claims
    app.use((req, _res, next) => {
      (req as any).isAuthenticated = () => true;
      const exp = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour
      (req as any).user = {
        claims: { sub: "dev-user", email: "maccollins44@gmail.com", exp },
        access_token: "dev",
        refresh_token: null,
        expires_at: exp,
      };
      next();
    });

    // Minimal stubs for login/logout/user
    app.get("/api/login", (_req, res) => res.redirect("/"));
    app.get("/api/auth/user", (_req, res) => res.json({
      id: "dev-user",
      email: "maccollins44@gmail.com",
      name: "Mac Collins",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }));
    app.post("/api/logout", (_req, res) => res.status(204).end());
    app.get("/api/callback", (_req, res) => res.redirect("/"));
    return;
  }

  // Real OIDC
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  for (const domain of AUTH_ALLOWED_DOMAINS!.split(",")) {
    const strategy = new Strategy(
      {
        name: `oidc:${domain}`,
        config,
        scope: "openid email profile offline_access",
        callbackURL: `https://${domain}/api/callback`,
      },
      verify,
    );
    passport.use(strategy);
  }

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    passport.authenticate(`oidc:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    passport.authenticate(`oidc:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: OIDC_CLIENT_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (DEV_BYPASS) return next();

  const user = req.user as any;
  if (!req.isAuthenticated() || !user?.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
