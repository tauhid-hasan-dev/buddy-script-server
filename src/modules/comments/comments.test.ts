import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import app from '../../app';
import prisma from '../../lib/prisma';

const EMAIL_PREFIX = 'test_comments_';
let emailCounter = 0;
const uniqueEmail = () => `${EMAIL_PREFIX}${process.pid}_${emailCounter++}@example.com`;

const PASSWORD = 'SuperSecret123';

async function registerUser() {
  const res = await request(app).post('/api/auth/register').send({
    firstName: 'Comment',
    lastName: 'Tester',
    email: uniqueEmail(),
    password: PASSWORD,
  });
  expect(res.status).toBe(201);

  const setCookie: string[] = res.get('Set-Cookie') ?? [];
  const cookie = setCookie.find((c) => c.startsWith('token='));
  return { cookie: cookie as string, id: res.body.user.id as string };
}

async function createPost(cookie: string, visibility = 'PUBLIC') {
  const res = await request(app)
    .post('/api/posts')
    .set('Cookie', cookie)
    .send({ content: 'post for comments', visibility });
  expect(res.status).toBe(201);
  return res.body.post;
}

async function createComment(
  cookie: string,
  postId: string,
  body: { content: string; parentId?: string }
) {
  const res = await request(app)
    .post(`/api/posts/${postId}/comments`)
    .set('Cookie', cookie)
    .send(body);
  expect(res.status).toBe(201);
  return res.body.comment;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

describe('POST /api/posts/:postId/comments', () => {
  it('returns 401 without authentication', async () => {
    const { cookie } = await registerUser();
    const post = await createPost(cookie);
    const res = await request(app)
      .post(`/api/posts/${post.id}/comments`)
      .send({ content: 'hi' });
    expect(res.status).toBe(401);
  });

  it('creates a top-level comment', async () => {
    const author = await registerUser();
    const commenter = await registerUser();
    const post = await createPost(author.cookie);

    const res = await request(app)
      .post(`/api/posts/${post.id}/comments`)
      .set('Cookie', commenter.cookie)
      .send({ content: 'Nice post!' });

    expect(res.status).toBe(201);
    expect(res.body.comment).toMatchObject({
      content: 'Nice post!',
      postId: post.id,
      parentId: null,
      likeCount: 0,
      replyCount: 0,
      likedByMe: false,
    });
    expect(res.body.comment.author.id).toBe(commenter.id);
  });

  it('creates a reply to a comment', async () => {
    const { cookie } = await registerUser();
    const post = await createPost(cookie);
    const comment = await createComment(cookie, post.id, { content: 'top' });

    const res = await request(app)
      .post(`/api/posts/${post.id}/comments`)
      .set('Cookie', cookie)
      .send({ content: 'a reply', parentId: comment.id });

    expect(res.status).toBe(201);
    expect(res.body.comment.parentId).toBe(comment.id);
  });

  it('rejects replies to replies', async () => {
    const { cookie } = await registerUser();
    const post = await createPost(cookie);
    const comment = await createComment(cookie, post.id, { content: 'top' });
    const reply = await createComment(cookie, post.id, {
      content: 'reply',
      parentId: comment.id,
    });

    const res = await request(app)
      .post(`/api/posts/${post.id}/comments`)
      .set('Cookie', cookie)
      .send({ content: 'reply to reply', parentId: reply.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/replies to replies/i);
  });

  it('404s a parent comment that belongs to a different post', async () => {
    const { cookie } = await registerUser();
    const postA = await createPost(cookie);
    const postB = await createPost(cookie);
    const commentOnA = await createComment(cookie, postA.id, { content: 'on A' });

    const res = await request(app)
      .post(`/api/posts/${postB.id}/comments`)
      .set('Cookie', cookie)
      .send({ content: 'cross-post reply', parentId: commentOnA.id });

    expect(res.status).toBe(404);
  });

  it("404s commenting on someone else's private post", async () => {
    const author = await registerUser();
    const other = await registerUser();
    const post = await createPost(author.cookie, 'PRIVATE');

    const res = await request(app)
      .post(`/api/posts/${post.id}/comments`)
      .set('Cookie', other.cookie)
      .send({ content: 'sneaky' });

    expect(res.status).toBe(404);
  });

  it('rejects empty content', async () => {
    const { cookie } = await registerUser();
    const post = await createPost(cookie);

    const res = await request(app)
      .post(`/api/posts/${post.id}/comments`)
      .set('Cookie', cookie)
      .send({ content: '   ' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/posts/:postId/comments and replies', () => {
  it('lists top-level comments newest first, excluding replies', async () => {
    const { cookie } = await registerUser();
    const post = await createPost(cookie);
    const first = await createComment(cookie, post.id, { content: 'first' });
    await createComment(cookie, post.id, { content: 'a reply', parentId: first.id });
    const second = await createComment(cookie, post.id, { content: 'second' });

    const res = await request(app)
      .get(`/api/posts/${post.id}/comments`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const contents = res.body.comments.map((c: { content: string }) => c.content);
    expect(contents).toEqual(['second', 'first']);
    expect(res.body.comments[1].replyCount).toBe(1);
    expect(second.replyCount).toBe(0);
  });

  it('paginates comments with a cursor', async () => {
    const { cookie } = await registerUser();
    const post = await createPost(cookie);
    for (let i = 1; i <= 3; i++) {
      await createComment(cookie, post.id, { content: `c${i}` });
    }

    const page1 = await request(app)
      .get(`/api/posts/${post.id}/comments?limit=2`)
      .set('Cookie', cookie);
    expect(page1.body.comments).toHaveLength(2);
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await request(app)
      .get(`/api/posts/${post.id}/comments?limit=2&cursor=${page1.body.nextCursor}`)
      .set('Cookie', cookie);
    expect(page2.body.comments).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('lists replies oldest first', async () => {
    const { cookie } = await registerUser();
    const post = await createPost(cookie);
    const top = await createComment(cookie, post.id, { content: 'top' });
    await createComment(cookie, post.id, { content: 'r1', parentId: top.id });
    await createComment(cookie, post.id, { content: 'r2', parentId: top.id });

    const res = await request(app)
      .get(`/api/comments/${top.id}/replies`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const contents = res.body.replies.map((r: { content: string }) => r.content);
    expect(contents).toEqual(['r1', 'r2']);
  });

  it("404s comments of someone else's private post", async () => {
    const author = await registerUser();
    const other = await registerUser();
    const post = await createPost(author.cookie, 'PRIVATE');

    const res = await request(app)
      .get(`/api/posts/${post.id}/comments`)
      .set('Cookie', other.cookie);

    expect(res.status).toBe(404);
  });
});

describe('comment likes', () => {
  it('likes and unlikes a comment with correct state', async () => {
    const { cookie } = await registerUser();
    const liker = await registerUser();
    const post = await createPost(cookie);
    const comment = await createComment(cookie, post.id, { content: 'like me' });

    const like = await request(app)
      .post(`/api/comments/${comment.id}/like`)
      .set('Cookie', liker.cookie);
    expect(like.status).toBe(200);
    expect(like.body).toEqual({ liked: true, likeCount: 1 });

    // Like state is per-viewer in listings.
    const listed = await request(app)
      .get(`/api/posts/${post.id}/comments`)
      .set('Cookie', liker.cookie);
    expect(listed.body.comments[0].likedByMe).toBe(true);
    expect(listed.body.comments[0].likeCount).toBe(1);

    const unlike = await request(app)
      .delete(`/api/comments/${comment.id}/like`)
      .set('Cookie', liker.cookie);
    expect(unlike.body).toEqual({ liked: false, likeCount: 0 });
  });

  it('liking a comment twice is idempotent', async () => {
    const { cookie } = await registerUser();
    const post = await createPost(cookie);
    const comment = await createComment(cookie, post.id, { content: 'x' });

    await request(app).post(`/api/comments/${comment.id}/like`).set('Cookie', cookie);
    const second = await request(app)
      .post(`/api/comments/${comment.id}/like`)
      .set('Cookie', cookie);

    expect(second.body).toEqual({ liked: true, likeCount: 1 });
  });

  it('lists who liked a comment', async () => {
    const { cookie } = await registerUser();
    const liker = await registerUser();
    const post = await createPost(cookie);
    const comment = await createComment(cookie, post.id, { content: 'popular' });

    await request(app).post(`/api/comments/${comment.id}/like`).set('Cookie', liker.cookie);

    const res = await request(app)
      .get(`/api/comments/${comment.id}/likes`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.likes[0].user.id).toBe(liker.id);
  });

  it("404s liking a comment on someone else's private post", async () => {
    const author = await registerUser();
    const other = await registerUser();
    const post = await createPost(author.cookie, 'PRIVATE');
    const comment = await createComment(author.cookie, post.id, { content: 'mine' });

    const res = await request(app)
      .post(`/api/comments/${comment.id}/like`)
      .set('Cookie', other.cookie);

    expect(res.status).toBe(404);
  });

  it('404s an unknown comment', async () => {
    const { cookie } = await registerUser();
    const res = await request(app)
      .post('/api/comments/999999999/like')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});
