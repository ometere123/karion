import rateLimit from "express-rate-limit";

const msg = (text: string) => ({ error: text });

export const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: msg("Too many signup attempts, try again later"),
  standardHeaders: true,
  legacyHeaders: false,
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: msg("Too many login attempts, try again later"),
  standardHeaders: true,
  legacyHeaders: false,
});

export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: msg("Too many password reset requests, try again later"),
  standardHeaders: true,
  legacyHeaders: false,
});

export const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: msg("Too many reset attempts, try again later"),
  standardHeaders: true,
  legacyHeaders: false,
});

export const walletRecoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: msg("Too many wallet recovery attempts, try again later"),
  standardHeaders: true,
  legacyHeaders: false,
});

export const exportKeyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 2,
  message: msg("Too many key export attempts, try again later"),
  standardHeaders: true,
  legacyHeaders: false,
});
