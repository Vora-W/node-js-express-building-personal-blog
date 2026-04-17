import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";
import connectionPool from "../utils/db.mjs";
import postValidation from "../middleware/postValidation.mjs";
import protectAdmin from "../middleware/protectAdmin.mjs";
import protectUser from "../middleware/protectUser.mjs";

const blogPostsRouter = Router();
const multerUpload = multer({ storage: multer.memoryStorage() });
const imageFileUpload = multerUpload.fields([{ name: "imageFile", maxCount: 1 }]);
const postsBucketName = process.env.SUPABASE_POSTS_BUCKET || "voranat-w-labs";
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

const sanitizeFileName = (fileName) =>
  fileName.replaceAll(/[^a-zA-Z0-9._-]/g, "_");

const parseNumericId = (value) => {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) ? parsedValue : null;
};

const buildPostMutationResponse = (row, status) => ({
  id: row?.id,
  status_id: row?.status_id,
  status_name: status.status,
});

const getPostById = async (postId, columns = "id") => {
  const { rows } = await connectionPool.query(
    `SELECT ${columns} FROM posts WHERE id = $1 LIMIT 1`,
    [postId],
  );

  return rows[0] ?? null;
};

const getLikeCount = async (postId) => {
  const { rows } = await connectionPool.query(
    "SELECT COUNT(*)::int AS likes_count FROM likes WHERE post_id = $1",
    [postId],
  );

  return rows[0]?.likes_count ?? 0;
};

const hasUserLikedPost = async (postId, userId) => {
  const { rows } = await connectionPool.query(
    "SELECT 1 FROM likes WHERE post_id = $1 AND user_id = $2 LIMIT 1",
    [postId, userId],
  );

  return rows.length > 0;
};

const getUserProfileSummary = async (userId) => {
  const { rows } = await connectionPool.query(
    "SELECT username, name, profile_pic FROM users WHERE id = $1 LIMIT 1",
    [userId],
  );

  return rows[0] ?? null;
};

const authorSelectSql = `
  (
    SELECT users.name
    FROM users
    WHERE users.role = 'admin'
    ORDER BY users.id ASC
    LIMIT 1
  ) AS author_name,
  (
    SELECT users.profile_pic
    FROM users
    WHERE users.role = 'admin'
    ORDER BY users.id ASC
    LIMIT 1
  ) AS author_profile_pic
`;

const normalizePostPayload = (req, _res, next) => {
  if (typeof req.body.category_id === "string") {
    req.body.category_id = Number(req.body.category_id);
  }

  if (typeof req.body.status_id === "string") {
    req.body.status_id = Number(req.body.status_id);
  }

  next();
};

const uploadPostImageIfPresent = async (req, res, next) => {
  const uploadedFile = req.files?.imageFile?.[0];
  if (!uploadedFile) {
    return next();
  }

  try {
    const filePath = `posts/${Date.now()}_${sanitizeFileName(
      uploadedFile.originalname,
    )}`;
    const { data, error } = await supabase.storage
      .from(postsBucketName)
      .upload(filePath, uploadedFile.buffer, {
        contentType: uploadedFile.mimetype,
        upsert: false,
      });

    if (error) {
      return res.status(500).json({
        message: "Server could not upload image",
        error: error.message,
      });
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(postsBucketName).getPublicUrl(data.path);

    req.body.image = publicUrl;
    return next();
  } catch (error) {
    return res.status(500).json({
      message: "Server could not upload image",
      error: error.message,
    });
  }
};

const adminPostUploadPipeline = [
  imageFileUpload,
  normalizePostPayload,
  protectAdmin,
  uploadPostImageIfPresent,
  postValidation,
];

const validatePostRelations = async ({ category_id, status_id }) => {
  const [{ rows: categoryRows }, { rows: statusRows }] = await Promise.all([
    connectionPool.query("SELECT id FROM categories WHERE id = $1", [category_id]),
    connectionPool.query("SELECT id, status FROM statuses WHERE id = $1", [status_id]),
  ]);

  return {
    category: categoryRows[0] ?? null,
    status: statusRows[0] ?? null,
  };
};

// node-js-build-creating-data-api-building-personal-blog-assignment
blogPostsRouter.post(
  "/",
  adminPostUploadPipeline,
  async (req, res) => {
    try {
      const newPost = { ...req.body };

      const { category, status } = await validatePostRelations(newPost);
      if (!category) {
        return res
          .status(400)
          .json({ message: "Selected category does not exist" });
      }

      if (!status) {
        return res.status(400).json({ message: "Selected status does not exist" });
      }

      const insertResult = await connectionPool.query(
        `INSERT INTO posts (title, image, category_id, description, content, status_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, status_id`,
        [
          newPost.title,
          newPost.image,
          newPost.category_id,
          newPost.description,
          newPost.content,
          newPost.status_id,
        ],
      );

      return res.status(201).json({
        message: "Created post successfully",
        post: buildPostMutationResponse(insertResult.rows[0], status),
      });
    } catch {
      return res.status(500).json({
        message: "Server could not create post because database connection",
      });
    }
  },
);

blogPostsRouter.get("/", async (req, res) => {
  try {
    const { categories, keywords, page = 1, limit = 6 } = req.query;
    const currentPage = Number(page) || 1;
    const limitNum = Number(limit) || 6;
    const offset = (currentPage - 1) * limitNum;

    const join =
      "FROM posts LEFT JOIN categories ON posts.category_id = categories.id LEFT JOIN statuses ON posts.status_id = statuses.id";
    let countSql = `SELECT COUNT(*)::int AS total ${join}`;
    let listSql = `SELECT posts.*, categories.name AS category_name, statuses.status AS status_name, ${authorSelectSql} ${join}`;
    let values = [];

    if (categories && keywords) {
      countSql += " WHERE categories.name ilike $1 AND posts.title ilike $2";
      listSql +=
        " WHERE categories.name ilike $1 AND posts.title ilike $2 ORDER BY posts.id DESC LIMIT $3 OFFSET $4";
      values = [`%${categories}%`, `%${keywords}%`, limitNum, offset];
    } else if (keywords) {
      countSql += " WHERE posts.title ilike $1";
      listSql +=
        " WHERE posts.title ilike $1 ORDER BY posts.id DESC LIMIT $2 OFFSET $3";
      values = [`%${keywords}%`, limitNum, offset];
    } else if (categories) {
      countSql += " WHERE categories.name ilike $1";
      listSql +=
        " WHERE categories.name ilike $1 ORDER BY posts.id DESC LIMIT $2 OFFSET $3";
      values = [`%${categories}%`, limitNum, offset];
    } else {
      listSql += " ORDER BY posts.id DESC LIMIT $1 OFFSET $2";
      values = [limitNum, offset];
    }

    const countValues = values.slice(0, -2);
    const countRes = await connectionPool.query(countSql, countValues);
    const totalPosts = countRes.rows[0]?.total ?? 0;
    const totalPages = Math.ceil(totalPosts / limitNum) || 1;

    const listRes = await connectionPool.query(listSql, values);
    const body = {
      totalPosts,
      totalPages,
      currentPage,
      limit: limitNum,
      posts: listRes.rows,
    };
    if (currentPage < totalPages) body.nextPage = currentPage + 1;

    return res.status(200).json(body);
  } catch (error) {
    return res.status(500).json({
      message: "Server could not read post because database connection",
    });
  }
});

blogPostsRouter.get("/admin/options", protectAdmin, async (req, res) => {
  try {
    const [{ rows: categories }, { rows: statuses }] = await Promise.all([
      connectionPool.query(
        "SELECT id, name FROM categories ORDER BY name ASC",
      ),
      connectionPool.query(
        "SELECT id, status FROM statuses ORDER BY id ASC",
      ),
    ]);

    return res.status(200).json({ categories, statuses });
  } catch (error) {
    return res.status(500).json({
      message: "Server could not load post options because database connection",
    });
  }
});

blogPostsRouter.get("/:postId/likes", async (req, res) => {
  const postId = parseNumericId(req.params.postId);
  if (postId === null) {
    return res.status(400).json({ error: "Post ID must be a number" });
  }

  try {
    const likesCount = await getLikeCount(postId);

    let likedByUser = false;
    const token = req.headers.authorization?.split(" ")[1];
    if (token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data.user) {
        likedByUser = await hasUserLikedPost(postId, data.user.id);
      }
    }

    return res.status(200).json({
      likesCount,
      likedByUser,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server could not load likes because database connection",
    });
  }
});

blogPostsRouter.post("/:postId/likes", protectUser, async (req, res) => {
  const postId = parseNumericId(req.params.postId);
  if (postId === null) {
    return res.status(400).json({ error: "Post ID must be a number" });
  }

  try {
    const post = await getPostById(postId);
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    const alreadyLiked = await hasUserLikedPost(postId, req.user.id);

    if (!alreadyLiked) {
      await connectionPool.query(
        "INSERT INTO likes (post_id, user_id, liked_at) VALUES ($1, $2, NOW())",
        [postId, req.user.id],
      );
    }

    const likesCount = await getLikeCount(postId);

    return res.status(200).json({
      message: alreadyLiked ? "Post already liked" : "Post liked successfully",
      likesCount,
      likedByUser: true,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server could not like post because database connection",
    });
  }
});

blogPostsRouter.get("/:postId/comments", async (req, res) => {
  const postId = parseNumericId(req.params.postId);
  if (postId === null) {
    return res.status(400).json({ error: "Post ID must be a number" });
  }

  try {
    const post = await getPostById(postId);
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    const { rows: commentRows } = await connectionPool.query(
      `SELECT
         comments.id,
         comments.post_id,
         comments.user_id,
         comments.comment_text,
         comments.created_at,
         users.username,
         users.name,
         users.profile_pic
       FROM comments
       LEFT JOIN users ON comments.user_id = users.id
       WHERE comments.post_id = $1
       ORDER BY comments.created_at DESC, comments.id DESC`,
      [postId],
    );

    return res.status(200).json({ comments: commentRows });
  } catch (error) {
    return res.status(500).json({
      error: "Server could not load comments because database connection",
    });
  }
});

blogPostsRouter.post("/:postId/comments", protectUser, async (req, res) => {
  const postId = parseNumericId(req.params.postId);
  if (postId === null) {
    return res.status(400).json({ error: "Post ID must be a number" });
  }

  const commentText = req.body.comment_text ?? req.body.commentText ?? "";
  if (!commentText.trim()) {
    return res.status(400).json({ error: "Comment text is required" });
  }

  try {
    const post = await getPostById(postId);
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    const { rows: insertedRows } = await connectionPool.query(
      `INSERT INTO comments (post_id, user_id, comment_text, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, post_id, user_id, comment_text, created_at`,
      [postId, req.user.id, commentText.trim()],
    );

    const insertedComment = insertedRows[0];

    const userProfile = await getUserProfileSummary(req.user.id);

    return res.status(201).json({
      message: "Comment created successfully",
      comment: {
        ...insertedComment,
        username: userProfile?.username ?? null,
        name: userProfile?.name ?? null,
        profile_pic: userProfile?.profile_pic ?? null,
      },
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server could not create comment because database connection",
    });
  }
});

blogPostsRouter.get("/:postId", async (req, res) => {
  try {
    const postIdFromClient = req.params.postId;
    const result = await connectionPool.query(
      `SELECT posts.*, categories.name AS category_name, statuses.status AS status_name, ${authorSelectSql}
       FROM posts
       LEFT JOIN categories ON posts.category_id = categories.id
       LEFT JOIN statuses ON posts.status_id = statuses.id
       WHERE posts.id = $1`,
      [postIdFromClient],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Server could not find a requested post",
      });
    }

    return res.status(200).json({ data: result.rows[0] });
  } catch (error) {
    return res.status(500).json({
      message: "Server could not read post because database connection",
    });
  }
});

blogPostsRouter.put(
  "/:postId",
  adminPostUploadPipeline,
  async (req, res) => {
    try {
      const postIdFromClient = req.params.postId;
      const { title, image, category_id, description, content, status_id } =
        req.body;

      const { category, status } = await validatePostRelations({
        category_id,
        status_id,
      });
      if (!category) {
        return res.status(400).json({ message: "Selected category does not exist" });
      }

      if (!status) {
        return res.status(400).json({ message: "Selected status does not exist" });
      }

      const result = await connectionPool.query(
        `UPDATE posts
         SET title = $1, image = $2, category_id = $3, description = $4, content = $5, status_id = $6
         WHERE id = $7
         RETURNING id, status_id`,
        [
          title,
          image,
          category_id,
          description,
          content,
          status_id,
          postIdFromClient,
        ],
      );
      if (result.rowCount === 0) {
        return res.status(404).json({
          message: "Server could not find a requested post to update",
        });
      }
      return res.status(200).json({
        message: "Updated post successfully",
        post: buildPostMutationResponse(result.rows[0], status),
      });
    } catch (error) {
      return res.status(500).json({
        message: "Server could not update post because database connection",
      });
    }
  },
);

blogPostsRouter.delete("/:postId", protectAdmin, async (req, res) => {
  try {
    const postIdFromClient = req.params.postId;
    const result = await connectionPool.query(
      "DELETE FROM posts WHERE id = $1",
      [postIdFromClient],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Server could not find a requested post to delete",
      });
    }
    return res.status(200).json({
      message: "Deleted post successfully",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server could not delete post because database connection",
    });
  }
});

export default blogPostsRouter;
