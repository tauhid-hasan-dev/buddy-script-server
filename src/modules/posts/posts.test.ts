import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import app from '../../app';
import config from '../../config';
import prisma from '../../lib/prisma';
import { StorageService } from '../../lib/storage';

const EMAIL_PREFIX = 'test_posts_';
let emailCounter = 0;
const uniqueEmail = () => `${EMAIL_PREFIX}${process.pid}_${emailCounter++}@example.com`;

const PASSWORD = 'SuperSecret123';
// Supabase Storage objects created by tests, removed in afterAll.
const uploadedImageUrls: string[] = [];
const storageConfigured = config.supabase !== null;

async function registerUser() {
  const res = await request(app).post('/api/auth/register').send({
    firstName: 'Post',
    lastName: 'Tester',
    email: uniqueEmail(),
    password: PASSWORD,
  });
  expect(res.status).toBe(201);

  const setCookie: string[] = res.get('Set-Cookie') ?? [];
  const cookie = setCookie.find((c) => c.startsWith('token='));
  expect(cookie).toBeDefined();

  return { cookie: cookie as string, id: res.body.user.id as string };
}

async function createPost(
  cookie: string,
  body: { content: string; visibility?: string } = { content: 'Hello world' }
) {
  const res = await request(app).post('/api/posts').set('Cookie', cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.post;
}

afterAll(async () => {
  // Cascades remove this suite's posts, comments, and likes.
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  await prisma.$disconnect();
  for (const url of uploadedImageUrls) {
    await StorageService.removeImage(url);
  }
});

describe('POST /api/posts', () => {
  it('returns 401 without authentication', async () => {
    const res = await request(app).post('/api/posts').send({ content: 'x' });
    expect(res.status).toBe(401);
  });

  it('creates a text post, public by default', async () => {
    const { cookie, id } = await registerUser();
    const res = await request(app)
      .post('/api/posts')
      .set('Cookie', cookie)
      .send({ content: 'My first post' });

    expect(res.status).toBe(201);
    expect(res.body.post).toMatchObject({
      content: 'My first post',
      visibility: 'PUBLIC',
      imageUrl: null,
      likeCount: 0,
      commentCount: 0,
      likedByMe: false,
    });
    expect(res.body.post.author.id).toBe(id);
    expect(typeof res.body.post.id).toBe('string');
  });

  it('creates a private post (case-insensitive visibility)', async () => {
    const { cookie } = await registerUser();
    const post = await createPost(cookie, { content: 'secret', visibility: 'private' });
    expect(post.visibility).toBe('PRIVATE');
  });

  // Requires real Supabase credentials in .env; skipped until configured.
  it.skipIf(!storageConfigured)(
    'creates a post with an image stored in Supabase Storage',
    async () => {
      const { cookie } = await registerUser();
      const res = await request(app)
        .post('/api/posts')
        .set('Cookie', cookie)
        .field('content', 'with image')
        .attach('image', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'photo.png');

      expect(res.status).toBe(201);
      expect(res.body.post.imageUrl).toMatch(
        /\/storage\/v1\/object\/public\/.+\.png$/
      );
      uploadedImageUrls.push(res.body.post.imageUrl);

      // The public URL actually serves the object.
      const img = await fetch(res.body.post.imageUrl);
      expect(img.status).toBe(200);
    }
  );

  it('rejects non-image uploads', async () => {
    const { cookie } = await registerUser();
    const res = await request(app)
      .post('/api/posts')
      .set('Cookie', cookie)
      .field('content', 'with attachment')
      .attach('image', Buffer.from('not an image'), 'malware.txt');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JPEG, PNG, WebP or GIF/);
  });

  it('rejects empty content even when an image is attached', async () => {
    // Validation runs before the storage upload, so a failed request never
    // creates an orphan object.
    const { cookie } = await registerUser();
    const res = await request(app)
      .post('/api/posts')
      .set('Cookie', cookie)
      .field('content', '   ')
      .attach('image', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'orphan.png');

    expect(res.status).toBe(400);
  });

  it('rejects an invalid visibility value', async () => {
    const { cookie } = await registerUser();
    const res = await request(app)
      .post('/api/posts')
      .set('Cookie', cookie)
      .send({ content: 'x', visibility: 'FRIENDS' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/posts/:id', () => {
  it('returns a public post to any user', async () => {
    const author = await registerUser();
    const viewer = await registerUser();
    const post = await createPost(author.cookie);

    const res = await request(app)
      .get(`/api/posts/${post.id}`)
      .set('Cookie', viewer.cookie);

    expect(res.status).toBe(200);
    expect(res.body.post.id).toBe(post.id);
  });

  it('returns a private post to its author', async () => {
    const author = await registerUser();
    const post = await createPost(author.cookie, { content: 's', visibility: 'PRIVATE' });

    const res = await request(app)
      .get(`/api/posts/${post.id}`)
      .set('Cookie', author.cookie);

    expect(res.status).toBe(200);
  });

  it('404s a private post for anyone else (no existence leak)', async () => {
    const author = await registerUser();
    const viewer = await registerUser();
    const post = await createPost(author.cookie, { content: 's', visibility: 'PRIVATE' });

    const res = await request(app)
      .get(`/api/posts/${post.id}`)
      .set('Cookie', viewer.cookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Post not found');
  });

  it('400s a malformed id', async () => {
    const { cookie } = await registerUser();
    const res = await request(app).get('/api/posts/abc').set('Cookie', cookie);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/posts/:id', () => {
  it('lets the author delete their own post', async () => {
    const author = await registerUser();
    const post = await createPost(author.cookie);

    const res = await request(app)
      .delete(`/api/posts/${post.id}`)
      .set('Cookie', author.cookie);

    expect(res.status).toBe(204);
    const row = await prisma.post.findUnique({ where: { id: BigInt(post.id) } });
    expect(row).toBeNull();
  });

  it("403s deleting someone else's post", async () => {
    const author = await registerUser();
    const attacker = await registerUser();
    const post = await createPost(author.cookie);

    const res = await request(app)
      .delete(`/api/posts/${post.id}`)
      .set('Cookie', attacker.cookie);

    expect(res.status).toBe(403);
    const row = await prisma.post.findUnique({ where: { id: BigInt(post.id) } });
    expect(row).not.toBeNull();
  });
});

describe('post likes', () => {
  it('likes and unlikes a post, reflected in likedByMe and count', async () => {
    const author = await registerUser();
    const liker = await registerUser();
    const post = await createPost(author.cookie);

    const like = await request(app)
      .post(`/api/posts/${post.id}/like`)
      .set('Cookie', liker.cookie);
    expect(like.status).toBe(200);
    expect(like.body).toEqual({ liked: true, likeCount: 1 });

    const seen = await request(app)
      .get(`/api/posts/${post.id}`)
      .set('Cookie', liker.cookie);
    expect(seen.body.post.likedByMe).toBe(true);
    expect(seen.body.post.likeCount).toBe(1);

    // The author hasn't liked it — state is per-viewer.
    const authorView = await request(app)
      .get(`/api/posts/${post.id}`)
      .set('Cookie', author.cookie);
    expect(authorView.body.post.likedByMe).toBe(false);

    const unlike = await request(app)
      .delete(`/api/posts/${post.id}/like`)
      .set('Cookie', liker.cookie);
    expect(unlike.status).toBe(200);
    expect(unlike.body).toEqual({ liked: false, likeCount: 0 });
  });

  it('liking twice is idempotent', async () => {
    const { cookie } = await registerUser();
    const post = await createPost(cookie);

    await request(app).post(`/api/posts/${post.id}/like`).set('Cookie', cookie);
    const second = await request(app)
      .post(`/api/posts/${post.id}/like`)
      .set('Cookie', cookie);

    expect(second.status).toBe(200);
    expect(second.body).toEqual({ liked: true, likeCount: 1 });
  });

  it('lists who liked a post, newest like first', async () => {
    const author = await registerUser();
    const liker1 = await registerUser();
    const liker2 = await registerUser();
    const post = await createPost(author.cookie);

    await request(app).post(`/api/posts/${post.id}/like`).set('Cookie', liker1.cookie);
    await request(app).post(`/api/posts/${post.id}/like`).set('Cookie', liker2.cookie);

    const res = await request(app)
      .get(`/api/posts/${post.id}/likes`)
      .set('Cookie', author.cookie);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
    const ids = res.body.likes.map((l: { user: { id: string } }) => l.user.id);
    expect(ids).toEqual([liker2.id, liker1.id]);
    expect(res.body.likes[0].user).not.toHaveProperty('email');
  });

  it("404s liking someone else's private post", async () => {
    const author = await registerUser();
    const other = await registerUser();
    const post = await createPost(author.cookie, { content: 's', visibility: 'PRIVATE' });

    const res = await request(app)
      .post(`/api/posts/${post.id}/like`)
      .set('Cookie', other.cookie);

    expect(res.status).toBe(404);
  });
});
