import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import app from '../../app';
import prisma from '../../lib/prisma';
import { signToken } from '../../utils/token';

// Every test email shares this prefix so cleanup can't touch real rows.
const EMAIL_PREFIX = 'test_auth_';
let emailCounter = 0;
const uniqueEmail = () => `${EMAIL_PREFIX}${process.pid}_${emailCounter++}@example.com`;

const PASSWORD = 'SuperSecret123';

const validBody = (overrides: Record<string, unknown> = {}) => ({
  firstName: 'Test',
  lastName: 'User',
  email: uniqueEmail(),
  password: PASSWORD,
  ...overrides,
});

const registerUser = async (body = validBody()) => {
  const res = await request(app).post('/api/auth/register').send(body);
  expect(res.status).toBe(201);
  return { body, res, cookie: extractAuthCookie(res) };
};

function extractAuthCookie(res: request.Response): string {
  const setCookie: string[] = res.get('Set-Cookie') ?? [];
  const tokenCookie = setCookie.find((c) => c.startsWith('token='));
  expect(tokenCookie, 'expected a token Set-Cookie header').toBeDefined();
  return tokenCookie as string;
}

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { startsWith: EMAIL_PREFIX } },
  });
  await prisma.$disconnect();
});

describe('POST /api/auth/register', () => {
  it('creates a user and returns 201 with the public profile', async () => {
    const body = validBody();
    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
    });
    expect(res.body.user.id).toBeDefined();
    expect(res.body.user.createdAt).toBeDefined();
  });

  it('never returns the password or its hash', async () => {
    const { res } = await registerUser();
    expect(JSON.stringify(res.body)).not.toContain('password');
    expect(JSON.stringify(res.body)).not.toContain('Hash');
  });

  it('stores the password hashed, not in plaintext', async () => {
    const { body } = await registerUser();
    const row = await prisma.user.findUnique({ where: { email: body.email } });
    expect(row?.passwordHash).toBeDefined();
    expect(row?.passwordHash).not.toBe(PASSWORD);
    expect(row?.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt format
  });

  it('sets an httpOnly, SameSite=Lax auth cookie (None+Secure in production)', async () => {
    const { cookie } = await registerUser();
    expect(cookie).toContain('HttpOnly');
    // NODE_ENV=test takes the development branch; production switches to
    // SameSite=None; Secure for the cross-site frontend → API deployment.
    expect(cookie).toContain('SameSite=Lax');
  });

  it('normalizes the email to lowercase', async () => {
    const email = uniqueEmail();
    const res = await request(app)
      .post('/api/auth/register')
      .send(validBody({ email: email.toUpperCase() }));

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email.toLowerCase());
  });

  it('rejects a duplicate email with 409', async () => {
    const { body } = await registerUser();
    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('rejects a duplicate email with different casing', async () => {
    const { body } = await registerUser();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...body, email: body.email.toUpperCase() });

    expect(res.status).toBe(409);
  });

  it('returns 400 with per-field details for an empty body', async () => {
    const res = await request(app).post('/api/auth/register').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    const fields = res.body.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(
      expect.arrayContaining(['firstName', 'lastName', 'email', 'password'])
    );
  });

  it('rejects an invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(validBody({ email: 'not-an-email' }));

    expect(res.status).toBe(400);
    const fields = res.body.details.map((d: { field: string }) => d.field);
    expect(fields).toContain('email');
  });

  it('rejects a password shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(validBody({ password: 'short1' }));

    expect(res.status).toBe(400);
    const fields = res.body.details.map((d: { field: string }) => d.field);
    expect(fields).toContain('password');
  });

  it('trims whitespace from names', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(validBody({ firstName: '  Test  ', lastName: '  User  ' }));

    expect(res.status).toBe(201);
    expect(res.body.user.firstName).toBe('Test');
    expect(res.body.user.lastName).toBe('User');
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials and sets the auth cookie', async () => {
    const { body } = await registerUser();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: body.email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(body.email);
    const cookie = extractAuthCookie(res);
    expect(cookie).toContain('HttpOnly');
  });

  it('accepts the email case-insensitively', async () => {
    const { body } = await registerUser();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: body.email.toUpperCase(), password: PASSWORD });

    expect(res.status).toBe(200);
  });

  it('rejects a wrong password with 401', async () => {
    const { body } = await registerUser();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: body.email, password: 'WrongPassword999' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('rejects an unknown email with the same generic message (no enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: uniqueEmail(), password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('returns 400 when fields are missing', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the current user with a valid cookie', async () => {
    const { body, cookie } = await registerUser();
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(body.email);
  });

  it('accepts a Bearer token as an alternative to the cookie', async () => {
    const { body, res: registerRes } = await registerUser();
    const token = signToken(registerRes.body.user.id);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(body.email);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Authentication required');
  });

  it('returns 401 for a malformed token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'token=not-a-real-jwt');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
  });

  it('returns 401 for a valid token whose user was deleted', async () => {
    const { body, cookie } = await registerUser();
    await prisma.user.delete({ where: { email: body.email } });

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the auth cookie', async () => {
    const { cookie } = await registerUser();
    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const setCookie: string[] = res.get('Set-Cookie') ?? [];
    const cleared = setCookie.find((c) => c.startsWith('token=;'));
    expect(cleared).toBeDefined();
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970');
  });
});

describe('authorization on protected routes', () => {
  it('blocks the feed without authentication', async () => {
    const res = await request(app).get('/api/feed');
    expect(res.status).toBe(401);
  });

  it('serves the feed to an authenticated user', async () => {
    const { cookie } = await registerUser();
    const res = await request(app).get('/api/feed').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.posts).toBeInstanceOf(Array);
    expect(res.body).toHaveProperty('nextCursor');
  });
});
