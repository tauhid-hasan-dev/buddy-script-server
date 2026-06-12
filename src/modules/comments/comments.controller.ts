import type { Request, Response } from 'express';
import { parseBigIntId } from '../../utils/ids';
import { likersQuerySchema } from '../posts/posts.validation';
import { CommentsService } from './comments.service';
import { commentsCursorSchema } from './comments.validation';

async function create(req: Request, res: Response): Promise<void> {
  const postId = parseBigIntId(req.params.postId, 'post id');
  const comment = await CommentsService.create(postId, req.user!.id, req.body);
  res.status(201).json({ comment });
}

async function listForPost(req: Request, res: Response): Promise<void> {
  const postId = parseBigIntId(req.params.postId, 'post id');
  const query = commentsCursorSchema.parse(req.query);
  const page = await CommentsService.listForPost(postId, req.user!.id, query);
  res.json(page);
}

async function listReplies(req: Request, res: Response): Promise<void> {
  const commentId = parseBigIntId(req.params.id, 'comment id');
  const query = commentsCursorSchema.parse(req.query);
  const page = await CommentsService.listReplies(commentId, req.user!.id, query);
  res.json(page);
}

async function like(req: Request, res: Response): Promise<void> {
  const commentId = parseBigIntId(req.params.id, 'comment id');
  const state = await CommentsService.like(commentId, req.user!.id);
  res.json(state);
}

async function unlike(req: Request, res: Response): Promise<void> {
  const commentId = parseBigIntId(req.params.id, 'comment id');
  const state = await CommentsService.unlike(commentId, req.user!.id);
  res.json(state);
}

async function likers(req: Request, res: Response): Promise<void> {
  const commentId = parseBigIntId(req.params.id, 'comment id');
  const query = likersQuerySchema.parse(req.query);
  const page = await CommentsService.likers(commentId, req.user!.id, query);
  res.json(page);
}

export const CommentsController = {
  create,
  listForPost,
  listReplies,
  like,
  unlike,
  likers,
};
