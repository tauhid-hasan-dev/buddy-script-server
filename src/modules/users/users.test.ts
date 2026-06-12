import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import app from '../../app';
import prisma from '../../lib/prisma';

// Distinct prefix from auth tests so the suites can't clean up each other's rows.
const EMAIL_PREFIX = 'test_users_';
let emailCounter = 0;
const uniqueEmail = () => `${EMAIL_PREFIX}${process.pid}_${emailCounter++}@example.com`;

const PASSWORD = 'SuperSecret123';

async function registerUser() {
  const body = {
    firstName: 'Test',
    lastName: 'User',
    email: uniqueEmail(),
    password: PASSWORD,
  };
  const res = await request(app).post('/api/auth/register').send(body);
  expect(res.status).toBe(201);

  const setCookie: string[] = res.get('Set-Cookie') ?? [];
  const cookie = setCookie.find((c) => c.startsWith('token='));
  expect(cookie).toBeDefined();

  return { body, cookie: cookie as string, id: res.body.user.id as string };
}

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { startsWith: EMAIL_PREFIX } },
  });
  await prisma.$disconnect();
});

describe('GET /api/users', () => {
  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('returns paginated public profiles with meta', async () => {
    const { cookie } = await registerUser();
    const res = await request(app)
      .get('/api/users?page=1&limit=5')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.users).toBeInstanceOf(Array);
    expect(res.body.users.length).toBeGreaterThan(0);
    expect(res.body.users.length).toBeLessThanOrEqual(5);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 5 });
    expect(res.body.meta.total).toBeGreaterThan(0);
    expect(res.body.meta.totalPages).toBeGreaterThan(0);
  });

  it('never exposes emails or password hashes in the list', async () => {
    const { cookie } = await registerUser();
    const res = await request(app).get('/api/users').set('Cookie', cookie);

    expect(res.status).toBe(200);
    for (const user of res.body.users) {
      expect(user).not.toHaveProperty('email');
    }
    expect(JSON.stringify(res.body)).not.toContain('Hash');
  });

  it('paginates: page 2 returns different users than page 1', async () => {
    // Ensure at least two rows exist.
    await registerUser();
    const { cookie } = await registerUser();

    const page1 = await request(app)
      .get('/api/users?page=1&limit=1')
      .set('Cookie', cookie);
    const page2 = await request(app)
      .get('/api/users?page=2&limit=1')
      .set('Cookie', cookie);

    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);
    expect(page1.body.users[0].id).not.toBe(page2.body.users[0].id);
  });

  it('rejects a limit above the cap', async () => {
    const { cookie } = await registerUser();
    const res = await request(app)
      .get('/api/users?limit=999')
      .set('Cookie', cookie);

    expect(res.status).toBe(400);
  });

  it('rejects a non-numeric page', async () => {
    const { cookie } = await registerUser();
    const res = await request(app)
      .get('/api/users?page=abc')
      .set('Cookie', cookie);

    expect(res.status).toBe(400);
  });
});

describe('GET /api/users/:id', () => {
  it('returns 401 without authentication', async () => {
    const { id } = await registerUser();
    const res = await request(app).get(`/api/users/${id}`);
    expect(res.status).toBe(401);
  });

  it('returns the public profile of another user', async () => {
    const target = await registerUser();
    const viewer = await registerUser();

    const res = await request(app)
      .get(`/api/users/${target.id}`)
      .set('Cookie', viewer.cookie);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: target.id,
      firstName: target.body.firstName,
      lastName: target.body.lastName,
    });
  });

  it('does not expose the email or password hash', async () => {
    const target = await registerUser();
    const viewer = await registerUser();

    const res = await request(app)
      .get(`/api/users/${target.id}`)
      .set('Cookie', viewer.cookie);

    expect(res.body.user).not.toHaveProperty('email');
    expect(JSON.stringify(res.body)).not.toContain('Hash');
  });

  it('returns 404 for an unknown user id', async () => {
    const { cookie } = await registerUser();
    const res = await request(app)
      .get('/api/users/00000000-0000-4000-8000-000000000000')
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('returns 400 for a malformed user id', async () => {
    const { cookie } = await registerUser();
    const res = await request(app)
      .get('/api/users/not-a-uuid')
      .set('Cookie', cookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid user id');
  });
});

describe('PATCH /api/users/me', () => {
  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .patch('/api/users/me')
      .send({ firstName: 'New' });
    expect(res.status).toBe(401);
  });

  it('updates the profile and persists the change', async () => {
    const { cookie, id } = await registerUser();

    const res = await request(app)
      .patch('/api/users/me')
      .set('Cookie', cookie)
      .send({ firstName: 'Updated', lastName: 'Name' });

    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe('Updated');
    expect(res.body.user.lastName).toBe('Name');

    const row = await prisma.user.findUnique({ where: { id } });
    expect(row?.firstName).toBe('Updated');
    expect(row?.lastName).toBe('Name');
  });

  it('allows updating a single field', async () => {
    const { cookie, body } = await registerUser();

    const res = await request(app)
      .patch('/api/users/me')
      .set('Cookie', cookie)
      .send({ firstName: 'OnlyFirst' });

    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe('OnlyFirst');
    expect(res.body.user.lastName).toBe(body.lastName); // unchanged
  });

  it('trims whitespace from updated names', async () => {
    const { cookie } = await registerUser();

    const res = await request(app)
      .patch('/api/users/me')
      .set('Cookie', cookie)
      .send({ firstName: '  Padded  ' });

    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe('Padded');
  });

  it('rejects an empty body', async () => {
    const { cookie } = await registerUser();

    const res = await request(app)
      .patch('/api/users/me')
      .set('Cookie', cookie)
      .send({});

    expect(res.status).toBe(400);
  });

  it('rejects an empty-string name', async () => {
    const { cookie } = await registerUser();

    const res = await request(app)
      .patch('/api/users/me')
      .set('Cookie', cookie)
      .send({ firstName: '   ' });

    expect(res.status).toBe(400);
  });

  it('rejects attempts to update fields outside the profile (email)', async () => {
    const { cookie, body, id } = await registerUser();

    const res = await request(app)
      .patch('/api/users/me')
      .set('Cookie', cookie)
      .send({ firstName: 'Sneaky', email: 'hijacked@example.com' });

    expect(res.status).toBe(400);

    // Nothing was changed by the rejected request.
    const row = await prisma.user.findUnique({ where: { id } });
    expect(row?.email).toBe(body.email);
    expect(row?.firstName).toBe(body.firstName);
  });

  it('only ever updates the authenticated user', async () => {
    const victim = await registerUser();
    const attacker = await registerUser();

    const res = await request(app)
      .patch('/api/users/me')
      .set('Cookie', attacker.cookie)
      .send({ firstName: 'Attacker' });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(attacker.id);

    // Victim untouched — identity comes from the JWT, not anything client-sent.
    const victimRow = await prisma.user.findUnique({ where: { id: victim.id } });
    expect(victimRow?.firstName).toBe(victim.body.firstName);
  });
});
