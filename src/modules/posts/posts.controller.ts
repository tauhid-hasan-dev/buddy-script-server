import type { Request, Response } from 'express';
import { parseBigIntId } from '../../utils/ids';
import { PostsService } from './posts.service';
import { likersQuerySchema } from './posts.validation';

async function create(req: Request, res: Response): Promise<void> {
  const post = await PostsService.create(req.user!.id, req.body, req.file);
  res.status(201).json({ post });
}

async function getPost(req: Request, res: Response): Promise<void> {
  const postId = parseBigIntId(req.params.id, 'post id');
  const post = await PostsService.getById(postId, req.user!.id);
  res.json({ post });
}

async function update(req: Request, res: Response): Promise<void> {
  const postId = parseBigIntId(req.params.id, 'post id');
  const post = await PostsService.update(postId, req.user!.id, req.body);
  res.json({ post });
}

async function remove(req: Request, res: Response): Promise<void> {
  const postId = parseBigIntId(req.params.id, 'post id');
  await PostsService.remove(postId, req.user!.id);
  res.status(204).end();
}

// Body is validated/defaulted by reactSchema in the route (no body → LIKE).
async function react(req: Request, res: Response): Promise<void> {
  const postId = parseBigIntId(req.params.id, 'post id');
  const state = await PostsService.react(postId, req.user!.id, req.body.type);
  res.json(state);
}

async function unreact(req: Request, res: Response): Promise<void> {
  const postId = parseBigIntId(req.params.id, 'post id');
  const state = await PostsService.unreact(postId, req.user!.id);
  res.json(state);
}

async function likers(req: Request, res: Response): Promise<void> {
  const postId = parseBigIntId(req.params.id, 'post id');
  const query = likersQuerySchema.parse(req.query);
  const page = await PostsService.likers(postId, req.user!.id, query);
  res.json(page);
}

export const PostsController = { create, getPost, update, remove, react, unreact, likers };
