-- CreateEnum
CREATE TYPE "ReactionType" AS ENUM ('LIKE', 'LOVE', 'CARE', 'HAHA', 'WOW', 'SAD', 'ANGRY');

-- AlterTable
ALTER TABLE "post_likes" ADD COLUMN     "type" "ReactionType" NOT NULL DEFAULT 'LIKE';

-- CreateIndex
CREATE INDEX "post_likes_post_id_type_idx" ON "post_likes"("post_id", "type");
