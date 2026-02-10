import "dotenv/config";

import express from "express";
import cors from "cors";
import connectionPool from "./utils/db.mjs";

const app = express();
const port = process.env.PORT || 4000;

app.use(express.json());

app.use(
  cors({
    origin: [
      "http://localhost:5173", // Frontend local (Vite)
      "http://localhost:3000", // Frontend local (React แบบอื่น)
      "https://voranat-w-labs-git-dev-voranats-projects.vercel.app", // Frontend ที่ Deploy แล้ว
    ],
  }),
);

app.get("/health", (req, res) => {
  res.status(200).json({ message: "OK" });
});

app.get("/test-db", async (req, res) => {
  try {
    const result = await connectionPool.query("SELECT NOW()");
    return res.json({
      message: "Database connection successful",
      timestamp: result.rows[0].now,
    });
  } catch (error) {
    console.error("Database connection failed:", error);
    return res.status(500).json({
      error: "Database connection failed",
    });
  }
});

// node-js-build-creating-data-api-building-personal-blog-assignment
app.post("/posts", async (req, res) => {
  try {
    const newPost = {
      ...req.body,
      date: new Date(),
    };

    // Validate required fields before touching the database
    if (
      !newPost.title ||
      !newPost.image ||
      !newPost.category_id ||
      !newPost.description ||
      !newPost.content ||
      !newPost.status_id
    ) {
      return res.status(400).json({
        message:
          "Server could not create post because there are missing data from client",
      });
    }

    await connectionPool.query(
      `INSERT INTO posts (title, image, category_id, description, content, status_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        newPost.title,
        newPost.image,
        newPost.category_id,
        newPost.description,
        newPost.content,
        newPost.status_id,
      ],
    );

    return res.status(201).json({ message: "Created post successfully" });
  } catch {
    return res.status(500).json({
      message: `Server could not create post because database connection`,
    });
  }
});

app.get("/posts", async (req, res) => {
  try {
    const { categories, keywords, page = 1, limit = 6 } = req.query;
    const currentPage = Number(page) || 1;
    const limitNum = Number(limit) || 6;
    const offset = (currentPage - 1) * limitNum;

    const join =
      "FROM posts LEFT JOIN categories ON posts.category_id = categories.id LEFT JOIN statuses ON posts.status_id = statuses.id";
    let countSql = `SELECT COUNT(*)::int AS total ${join}`;
    let listSql = `SELECT posts.*, categories.name AS category_name, statuses.status AS status_name ${join}`;
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

app.get("/posts/:postId", async (req, res) => {
  try {
    const postIdFromClient = req.params.postId;
    const result = await connectionPool.query(
      "SELECT * FROM posts WHERE id = $1",
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

app.put("/posts/:postId", async (req, res) => {
  try {
    const postIdFromClient = req.params.postId;
    const { title, image, category_id, description, content, status_id } =
      req.body;
    const result = await connectionPool.query(
      "UPDATE posts SET title = $1, image = $2, category_id = $3, description = $4, content = $5, status_id = $6 WHERE id = $7",
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
      message: "Updated post successfully" 
    });
  } catch (error) {
    return res
      .status(500)
      .json({
        message: "Server could not update post because database connection",
      });
  }
});

app.delete("/posts/:postId", async (req, res) => {
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

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server is running at ${port}`);
  });
}

export default app;