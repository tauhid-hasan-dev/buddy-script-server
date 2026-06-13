-- Fix: the counter trigger functions referenced `posts` unqualified, so they
-- depended on the connection's search_path including the app schema. Through
-- the pgBouncer transaction pooler that search_path is not reliably set on the
-- backend executing the trigger, causing intermittent
-- `42P01: relation "posts" does not exist` on insert/delete of likes/comments.
--
-- Make the functions schema-independent: `posts` lives in the same schema as
-- the triggering table (post_likes / comments), so resolve it via
-- TG_TABLE_SCHEMA with dynamic SQL. Replacing the function bodies is enough —
-- the existing triggers reference these functions by name.

CREATE OR REPLACE FUNCTION "posts_like_count_sync"() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    EXECUTE format('UPDATE %I.posts SET like_count = like_count + 1 WHERE id = $1', TG_TABLE_SCHEMA) USING NEW.post_id;
  ELSIF (TG_OP = 'DELETE') THEN
    EXECUTE format('UPDATE %I.posts SET like_count = like_count - 1 WHERE id = $1', TG_TABLE_SCHEMA) USING OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "posts_comment_count_sync"() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    EXECUTE format('UPDATE %I.posts SET comment_count = comment_count + 1 WHERE id = $1', TG_TABLE_SCHEMA) USING NEW.post_id;
  ELSIF (TG_OP = 'DELETE') THEN
    EXECUTE format('UPDATE %I.posts SET comment_count = comment_count - 1 WHERE id = $1', TG_TABLE_SCHEMA) USING OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
