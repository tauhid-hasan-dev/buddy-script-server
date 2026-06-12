import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import app from '../../app';
import prisma from '../../lib/prisma';

const EMAIL_PREFIX = 'test_feed_';
let emailCounter = 0;
const uniqueEmail = () => `${EMAIL_PREFIX}${process.pid}_${emailCounter++}@example.com`;

const PASSWORD = 'SuperSecret123';

async function registerUser() {
  const res = await request(app).post('/api/auth/register').send({
    firstName: 'Feed',
    lastName: 'Tester',
    email: uniqueEmail(),
    password: PASSWORD,
  });
  expect(res.status).toBe(201);
  const setCookie: string[] = res.get('Set-Cookie') ?? [];
  const cookie = setCookie.find((c) => c.startsWith('token='));
  return { cookie: cookie as string, id: res.body.user.id as string };
}

async function createPost(cookie: string, content: string, visibility = 'PUBLIC') {
  const res = await request(app)
    .post('/api/posts')
    .set('Cookie', cookie)
    .send({ content, visibility });
  expect(res.status).toBe(201);
  return res.body.post;
}

const feedContents = (body: { posts: { content: string }[] }) =>
  body.posts.map((p) => p.content);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

describe('GET /api/feed', () => {
  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/api/feed');
    expect(res.status).toBe(401);
  });

  it('shows posts from all users, newest first', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const p1 = await createPost(alice.cookie, 'feed-order-1');
    const p2 = await createPost(bob.cookie, 'feed-order-2');

    const res = await request(app).get('/api/feed?limit=50').set('Cookie', alice.cookie);

    expect(res.status).toBe(200);
    const contents = feedContents(res.body);
    const idx1 = contents.indexOf('feed-order-1');
    const idx2 = contents.indexOf('feed-order-2');
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeLessThan(idx1); // newer post first
    expect(BigInt(p2.id)).toBeGreaterThan(BigInt(p1.id));
  });

  it("hides other users' private posts but shows your own", async () => {
    const author = await registerUser();
    const stranger = await registerUser();
    await createPost(author.cookie, 'my-private-note', 'PRIVATE');

    const own = await request(app).get('/api/feed?limit=50').set('Cookie', author.cookie);
    expect(feedContents(own.body)).toContain('my-private-note');

    const other = await request(app)
      .get('/api/feed?limit=50')
      .set('Cookie', stranger.cookie);
    expect(feedContents(other.body)).not.toContain('my-private-note');
  });

  it('includes author, like state, and counts on each post', async () => {
    const author = await registerUser();
    const liker = await registerUser();
    const post = await createPost(author.cookie, 'enriched-post');
    await request(app).post(`/api/posts/${post.id}/like`).set('Cookie', liker.cookie);
    await request(app)
      .post(`/api/posts/${post.id}/comments`)
      .set('Cookie', liker.cookie)
      .send({ content: 'nice' });

    const res = await request(app).get('/api/feed?limit=50').set('Cookie', liker.cookie);
    const found = res.body.posts.find((p: { id: string }) => p.id === post.id);

    expect(found).toMatchObject({
      content: 'enriched-post',
      likeCount: 1,
      commentCount: 1,
      likedByMe: true,
      visibility: 'PUBLIC',
    });
    expect(found.author.id).toBe(author.id);
    expect(found.author).not.toHaveProperty('email');
  });

  it('paginates with a cursor without overlap', async () => {
    const { cookie } = await registerUser();
    for (let i = 1; i <= 3; i++) {
      await createPost(cookie, `cursor-page-${i}`);
    }

    const page1 = await request(app).get('/api/feed?limit=2').set('Cookie', cookie);
    expect(page1.body.posts).toHaveLength(2);
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await request(app)
      .get(`/api/feed?limit=2&cursor=${page1.body.nextCursor}`)
      .set('Cookie', cookie);

    const ids1 = page1.body.posts.map((p: { id: string }) => p.id);
    const ids2 = page2.body.posts.map((p: { id: string }) => p.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
  });
});
