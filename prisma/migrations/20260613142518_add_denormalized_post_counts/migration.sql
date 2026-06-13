-- AlterTable: denormalized counters (default 0; backfilled below, then
-- maintained by triggers). Adding a NOT NULL column with a constant DEFAULT is
-- a metadata-only change in modern Postgres — no table rewrite, no long lock.
ALTER TABLE "posts" ADD COLUMN     "comment_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "like_count" INTEGER NOT NULL DEFAULT 0;

-- One-time backfill from the existing rows so the new columns are correct for
-- all data created before this migration.
UPDATE "posts" p SET
  "like_count"    = (SELECT count(*) FROM "post_likes" pl WHERE pl."post_id" = p."id"),
  "comment_count" = (SELECT count(*) FROM "comments"   c  WHERE c."post_id"  = p."id");

-- Counter maintenance. AFTER INSERT/DELETE row triggers keep the denormalized
-- columns exact. A reaction *switch* is an UPDATE of post_likes.type, which
-- these triggers ignore, so like_count is unaffected by switches (correct:
-- still one reaction). Cascade-deleting a post updates an already-removed posts
-- row → matches 0 rows → harmless no-op.

CREATE OR REPLACE FUNCTION "posts_like_count_sync"() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE "posts" SET "like_count" = "like_count" + 1 WHERE "id" = NEW."post_id";
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE "posts" SET "like_count" = "like_count" - 1 WHERE "id" = OLD."post_id";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "posts_comment_count_sync"() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE "posts" SET "comment_count" = "comment_count" + 1 WHERE "id" = NEW."post_id";
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE "posts" SET "comment_count" = "comment_count" - 1 WHERE "id" = OLD."post_id";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "post_likes_count_aid"
AFTER INSERT OR DELETE ON "post_likes"
FOR EACH ROW EXECUTE FUNCTION "posts_like_count_sync"();

CREATE TRIGGER "comments_count_aid"
AFTER INSERT OR DELETE ON "comments"
FOR EACH ROW EXECUTE FUNCTION "posts_comment_count_sync"();
