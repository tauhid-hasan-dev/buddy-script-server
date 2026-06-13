import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import app from '../../app';
import config from '../../config';
import prisma from '../../lib/prisma';
import { StorageService } from '../../lib/storage';

// Distinct prefix from auth tests so the suites can't clean up each other's rows.
const EMAIL_PREFIX = 'test_users_';
let emailCounter = 0;
const uniqueEmail = () => `${EMAIL_PREFIX}${process.pid}_${emailCounter++}@example.com`;

const PASSWORD = 'SuperSecret123';

// Avatar upload hits real Supabase Storage; objects are removed in afterAll.
const uploadedImageUrls: string[] = [];
const storageConfigured = config.supabase !== null;
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

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
  for (const url of uploadedImageUrls) {
    await StorageService.removeImage(url);
  }
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

  it('includes emails but never password hashes in the list', async () => {
    const { cookie, body } = await registerUser();
    const res = await request(app).get('/api/users').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const emails = res.body.users.map((u: { email: string }) => u.email);
    expect(emails).toContain(body.email);
    expect(JSON.stringify(res.body)).not.toContain('Hash');
  });

  it('paginates with distinct, correctly-sized pages', async () => {
    // Ensure at least two rows exist. Comparing page 1 vs page 2 across two
    // requests is racy (other suites insert users concurrently, shifting the
    // offset window), so distinctness is asserted within a single response.
    await registerUser();
    const { cookie } = await registerUser();

    const res = await request(app)
      .get('/api/users?page=1&limit=2')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(2);
    expect(res.body.users[0].id).not.toBe(res.body.users[1].id);

    const page2 = await request(app)
      .get('/api/users?page=2&limit=1')
      .set('Cookie', cookie);
    expect(page2.status).toBe(200);
    expect(page2.body.meta.page).toBe(2);
    expect(page2.body.users).toHaveLength(1);
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
      email: target.body.email,
    });
  });

  it('never exposes the password hash', async () => {
    const target = await registerUser();
    const viewer = await registerUser();

    const res = await request(app)
      .get(`/api/users/${target.id}`)
      .set('Cookie', viewer.cookie);

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

describe('user avatar', () => {
  it('new accounts have a null avatar (the client shows a default icon)', async () => {
    const { cookie, id } = await registerUser();

    // Surfaced on /me, in the public profile, and in the directory list.
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.avatarUrl).toBeNull();

    const profile = await request(app).get(`/api/users/${id}`).set('Cookie', cookie);
    expect(profile.body.user.avatarUrl).toBeNull();
  });

  describe('POST /api/users/me/avatar', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/users/me/avatar')
        .attach('avatar', PNG_BYTES, 'a.png');
      expect(res.status).toBe(401);
    });

    it('returns 400 when no file is attached', async () => {
      const { cookie } = await registerUser();
      const res = await request(app)
        .post('/api/users/me/avatar')
        .set('Cookie', cookie);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('An image file is required');
    });

    it('rejects non-image uploads', async () => {
      const { cookie } = await registerUser();
      const res = await request(app)
        .post('/api/users/me/avatar')
        .set('Cookie', cookie)
        .attach('avatar', Buffer.from('not an image'), 'malware.txt');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/JPEG, PNG, WebP or GIF/);
    });

    it.skipIf(!storageConfigured)(
      'uploads an avatar, persists it, and surfaces it everywhere the author appears',
      async () => {
        const { cookie, id } = await registerUser();

        const res = await request(app)
          .post('/api/users/me/avatar')
          .set('Cookie', cookie)
          .attach('avatar', PNG_BYTES, 'me.png');

        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe(id);
        expect(res.body.user.avatarUrl).toMatch(
          /\/storage\/v1\/object\/public\/.+\.png$/
        );
        expect(JSON.stringify(res.body)).not.toContain('Hash');
        uploadedImageUrls.push(res.body.user.avatarUrl);
        const avatarUrl = res.body.user.avatarUrl as string;

        // Persisted to the row.
        const row = await prisma.user.findUnique({ where: { id } });
        expect(row?.avatarUrl).toBe(avatarUrl);

        // Surfaced on /me.
        const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
        expect(me.body.user.avatarUrl).toBe(avatarUrl);

        // Surfaced as the post author's avatar — verifies the single-query
        // feed/post projection carries avatar_url with no extra round-trip.
        const created = await request(app)
          .post('/api/posts')
          .set('Cookie', cookie)
          .send({ content: 'post by a user with an avatar' });
        expect(created.status).toBe(201);
        const postId = created.body.post.id as string;
        expect(created.body.post.author.avatarUrl).toBe(avatarUrl);

        const fetched = await request(app)
          .get(`/api/posts/${postId}`)
          .set('Cookie', cookie);
        expect(fetched.body.post.author.avatarUrl).toBe(avatarUrl);

        // And as the comment author's avatar.
        const comment = await request(app)
          .post(`/api/posts/${postId}/comments`)
          .set('Cookie', cookie)
          .send({ content: 'a comment' });
        expect(comment.status).toBe(201);
        expect(comment.body.comment.author.avatarUrl).toBe(avatarUrl);
      }
    );

    it.skipIf(!storageConfigured)(
      'replaces an existing avatar with the new one',
      async () => {
        const { cookie, id } = await registerUser();

        const first = await request(app)
          .post('/api/users/me/avatar')
          .set('Cookie', cookie)
          .attach('avatar', PNG_BYTES, 'first.png');
        uploadedImageUrls.push(first.body.user.avatarUrl);

        const second = await request(app)
          .post('/api/users/me/avatar')
          .set('Cookie', cookie)
          .attach('avatar', PNG_BYTES, 'second.png');
        uploadedImageUrls.push(second.body.user.avatarUrl);

        expect(second.status).toBe(200);
        expect(second.body.user.avatarUrl).not.toBe(first.body.user.avatarUrl);

        const row = await prisma.user.findUnique({ where: { id } });
        expect(row?.avatarUrl).toBe(second.body.user.avatarUrl);
      }
    );
  });

  describe('DELETE /api/users/me/avatar', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).delete('/api/users/me/avatar');
      expect(res.status).toBe(401);
    });

    it.skipIf(!storageConfigured)(
      'clears the avatar back to null',
      async () => {
        const { cookie, id } = await registerUser();

        const up = await request(app)
          .post('/api/users/me/avatar')
          .set('Cookie', cookie)
          .attach('avatar', PNG_BYTES, 'temp.png');
        uploadedImageUrls.push(up.body.user.avatarUrl);

        const res = await request(app)
          .delete('/api/users/me/avatar')
          .set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.user.avatarUrl).toBeNull();

        const row = await prisma.user.findUnique({ where: { id } });
        expect(row?.avatarUrl).toBeNull();
      }
    );
  });
});
